import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { ApiError, baseUrl, toApiError } from './api/client';
import type { FileRow } from './db/queries';
import type { Candidate } from './types';

type FileSystemModule = typeof import('expo-file-system/legacy');
type SharingModule = typeof import('expo-sharing');
type IntentModule = typeof import('expo-intent-launcher');

const MISSING = "This build of the app can't open files yet. Install the newest build of the app.";

// The native parts are loaded when they are first needed, so the rest of the app
// still runs in a build that doesn't have them (like the clipboard does).
export function fileSystem(): FileSystemModule {
  try {
    return require('expo-file-system/legacy') as FileSystemModule;
  } catch {
    throw new ApiError('incompatible', MISSING);
  }
}

function sharing(): SharingModule {
  try {
    return require('expo-sharing') as SharingModule;
  } catch {
    throw new ApiError('incompatible', MISSING);
  }
}

function intents(): IntentModule {
  try {
    return require('expo-intent-launcher') as IntentModule;
  } catch {
    throw new ApiError('incompatible', MISSING);
  }
}

// ---------- addresses and errors ----------

export function fileUrl(c: Pick<Candidate, 'host' | 'port'>, row: Pick<FileRow, 'path'>): string {
  return `${baseUrl(c)}/download?path=${encodeURIComponent(row.path)}`;
}

export function authHeaders(c: Pick<Candidate, 'token'>): Record<string, string> {
  return { Authorization: `Bearer ${c.token}` };
}

function explainStatus(status: number): ApiError {
  switch (status) {
    case 401:
      return new ApiError('unauthorized');
    case 403:
      return new ApiError('server', "The PC didn't allow this. File access may have been switched off, or the file can't be read.");
    case 404:
      return new ApiError('server', "That file isn't available any more. Update the list and try again.");
    case 429:
      return new ApiError('server', 'Too many failed attempts. Wait a minute and try again.');
    case 503:
      return new ApiError('server', 'The PC is busy sending other files. Try again in a moment.');
    default:
      return new ApiError('server', `The PC returned an error (${status}).`);
  }
}

// ---------- what can be previewed, and how a type is opened ----------

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'log', 'json', 'csv', 'tsv', 'xml', 'yml', 'yaml', 'ini', 'conf', 'cfg', 'toml',
  'js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'css', 'html', 'sh', 'sql', 'tex',
]);
const MAX_IMAGE_PREVIEW = 25 * 1024 * 1024;
const MAX_TEXT_PREVIEW = 2 * 1024 * 1024;

export function previewKind(row: Pick<FileRow, 'ext' | 'size' | 'isDir'>): 'image' | 'text' | null {
  if (row.isDir) return null;
  const ext = row.ext.toLowerCase();
  if (IMAGE_EXT.has(ext) && row.size <= MAX_IMAGE_PREVIEW) return 'image';
  if (TEXT_EXT.has(ext) && row.size <= MAX_TEXT_PREVIEW) return 'text';
  return null;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', svg: 'image/svg+xml',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', xml: 'application/xml', html: 'text/html',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
  mp4: 'video/mp4', mkv: 'video/x-matroska', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar', gz: 'application/gzip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  apk: 'application/vnd.android.package-archive',
  epub: 'application/epub+zip',
};

export function mimeFor(ext: string): string {
  return MIME[ext.toLowerCase()] ?? '*/*';
}

// ---------- reading the start of a text file ----------

/** The first lines of a text file, or null if it isn't text. Only the first 4 KB are requested. */
export async function fetchTextPreview(c: Candidate, row: FileRow): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(fileUrl(c, row), {
      headers: { ...authHeaders(c), Range: 'bytes=0-4095' },
      signal: controller.signal,
    });
    if (!res.ok) throw explainStatus(res.status);
    const text = (await res.text()).slice(0, 4096);
    if (text.includes('\u0000')) return null; // binary
    return text.split('\n').slice(0, 40).join('\n').trimEnd();
  } catch (e) {
    throw toApiError(e);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- copying a file to the phone ----------

/** A file name that is safe to store (letters, digits and a few marks are kept). */
function safeName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._ ()-]/gu, '_');
  if (cleaned.length <= 80) return cleaned || 'file';
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 80 - ext.length) + ext;
}

/** A short, stable code for a path, so each file gets its own temporary folder. */
function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// Every temporary copy lives in its own folder ("opened/<hash>-<mtime>/<name>"), so it keeps its real name.
async function removeOldFiles(FS: FileSystemModule, dir: string): Promise<void> {
  try {
    const cutoff = Date.now() / 1000 - 24 * 3600;
    for (const name of await FS.readDirectoryAsync(dir)) {
      const info = await FS.getInfoAsync(dir + name);
      if (info.exists && info.modificationTime !== undefined && info.modificationTime < cutoff) {
        await FS.deleteAsync(dir + name, { idempotent: true });
      }
    }
  } catch {
    // clean-up is best effort
  }
}

export interface FileDownload {
  promise: Promise<string>; // the temporary copy's address
  cancel: () => void;
  cancelled: () => boolean;
}

/** Copies a file from the PC into the app's temporary storage. Re-uses a copy that is already there. */
export function downloadToCache(c: Candidate, row: FileRow, onProgress: (fraction: number) => void): FileDownload {
  let wasCancelled = false;
  let resumable: ReturnType<FileSystemModule['createDownloadResumable']> | null = null;

  const promise = (async (): Promise<string> => {
    const FS = fileSystem();
    if (!FS.cacheDirectory) throw new ApiError('incompatible', MISSING);
    const root = `${FS.cacheDirectory}opened/`;
    await FS.makeDirectoryAsync(root, { intermediates: true }).catch(() => undefined);
    await removeOldFiles(FS, root);

    const folder = `${root}${shortHash(row.path)}-${row.mtime}/`;
    await FS.makeDirectoryAsync(folder, { intermediates: true }).catch(() => undefined);
    const target = `${folder}${safeName(row.name)}`;
    const existing = await FS.getInfoAsync(target);
    if (existing.exists && existing.size === row.size) {
      onProgress(1);
      return target;
    }

    resumable = FS.createDownloadResumable(fileUrl(c, row), target, { headers: authHeaders(c) }, (p) => {
      const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : row.size;
      if (total > 0) onProgress(Math.min(1, p.totalBytesWritten / total));
    });

    try {
      const result = await resumable.downloadAsync();
      if (wasCancelled || !result) throw new ApiError('network', 'Cancelled');
      if (result.status !== 200) throw explainStatus(result.status);
      return result.uri;
    } catch (e) {
      await FS.deleteAsync(target, { idempotent: true }).catch(() => undefined);
      throw wasCancelled ? new ApiError('network', 'Cancelled') : toApiError(e);
    }
  })();

  return {
    promise,
    cancel: () => {
      wasCancelled = true;
      void resumable?.cancelAsync().catch(() => undefined);
    },
    cancelled: () => wasCancelled,
  };
}

/** Deletes every file copied for opening (used when the PC is forgotten). */
export async function clearOpenedFiles(): Promise<void> {
  try {
    const FS = require('expo-file-system/legacy') as FileSystemModule;
    if (FS.cacheDirectory) await FS.deleteAsync(`${FS.cacheDirectory}opened/`, { idempotent: true });
  } catch {
    // nothing to clear, or this build has no file support
  }
}

// ---------- opening and sharing ----------

export async function shareFile(uri: string, row: Pick<FileRow, 'ext' | 'name'>): Promise<void> {
  const Sharing = sharing();
  if (!(await Sharing.isAvailableAsync())) {
    throw new ApiError('incompatible', "Sharing isn't available on this device.");
  }
  const mime = mimeFor(row.ext);
  await Sharing.shareAsync(uri, { mimeType: mime === '*/*' ? undefined : mime, dialogTitle: row.name });
}

/** Opens a file with the phone's own app for its type. Falls back to the share sheet. */
export async function openFile(uri: string, row: Pick<FileRow, 'ext' | 'name'>): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      const FS = fileSystem();
      const Intent = intents();
      const contentUri = await FS.getContentUriAsync(uri);
      await Intent.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // let the other app read this one file
        type: mimeFor(row.ext),
      });
      return;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // no app on this phone handles that type: the share sheet still lets the person choose one
    }
  }
  await shareFile(uri, row);
}