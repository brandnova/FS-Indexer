import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';
import { ApiError } from './api/client';
import { fileSystem, mimeFor } from './files';

// The new expo-file-system API is described loosely here on purpose, so a small difference
// between versions shows up as a message in the sheet and not as a build error.
interface DirLike {
  uri: string;
  list(): Array<{ name: string; uri: string }>;
  create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
}
interface FileLike {
  uri: string;
  copy(destination: unknown): void;
}
interface NextFs {
  Directory: { new (...parts: unknown[]): DirLike; pickDirectoryAsync(initialUri?: string): Promise<DirLike> };
  File: new (...parts: unknown[]) => FileLike;
  Paths: { document: unknown };
}
type IntentModule = typeof import('expo-intent-launcher');

const KEY = 'save-folder';
const DOWNLOADS_HINT = 'content://com.android.externalstorage.documents/document/primary%3ADownload';
const MISSING = "This build of the app can't save files yet. Install the newest build of the app.";

function nextFs(): NextFs {
  try {
    return require('expo-file-system') as unknown as NextFs;
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

/** The person closed the folder picker: not an error. */
export class UserCancelled extends Error {
  constructor() {
    super('Cancelled');
    Object.setPrototypeOf(this, UserCancelled.prototype);
    this.name = 'UserCancelled';
  }
}

const isCancel = (e: unknown) => /cancel/i.test(String((e as { message?: string })?.message ?? e));

// ---------- the folder downloads go to ----------

/** Where Android downloads go, in words: "Internal storage › Download › FS Browser". */
export function describeFolder(uri: string): string {
  const m = /\/tree\/([^/?#]+)/.exec(uri);
  if (!m) return 'the folder you chose';
  const id = decodeURIComponent(m[1]); // "primary:Download/FS Browser"
  const [volume, ...rest] = id.split(':');
  const path = rest.join(':').split('/').filter(Boolean);
  return [volume === 'primary' ? 'Internal storage' : 'SD card', ...path].join(' › ');
}

const IOS_WHERE = 'Files app › On My iPhone › this app › Downloads';

/** Where a download will go, or null if the person hasn't chosen yet (Android). */
export async function getSaveFolderLabel(): Promise<string | null> {
  if (Platform.OS === 'ios') return IOS_WHERE;
  const uri = await SecureStore.getItemAsync(KEY);
  return uri ? describeFolder(uri) : null;
}

/** Opens the system folder picker (Android). Returns the new folder's name, or null if cancelled. */
export async function chooseSaveFolder(): Promise<string | null> {
  if (Platform.OS !== 'android') return IOS_WHERE;
  const { Directory } = nextFs();
  let picked: DirLike | null = null;
  try {
    picked = await Directory.pickDirectoryAsync(DOWNLOADS_HINT);
  } catch (e) {
    if (isCancel(e)) return null;
    try {
      picked = await Directory.pickDirectoryAsync();
    } catch (e2) {
      if (isCancel(e2)) return null;
      throw new ApiError('server', "Couldn't open the folder picker.");
    }
  }
  if (!picked) return null;
  await SecureStore.setItemAsync(KEY, picked.uri);
  return describeFolder(picked.uri);
}

export async function forgetSaveFolder(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

// ---------- saving ----------

export interface SaveResult {
  where: string; // the folder, in words
  fileName: string; // the name it was saved under (a taken name becomes "name (1).ext")
  folderUri: string;
  fileUri: string | null;
  mime: string;
}

function uniqueName(dir: DirLike, name: string): string {
  let taken: Set<string>;
  try {
    taken = new Set(dir.list().map((e) => e.name));
  } catch {
    return name;
  }
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

async function targetFolder(): Promise<{ dir: DirLike; where: string; stored: boolean }> {
  const { Directory, Paths } = nextFs();
  if (Platform.OS === 'ios') {
    const dir = new Directory(Paths.document, 'Downloads');
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch {
      // it already exists
    }
    return { dir, where: IOS_WHERE, stored: false };
  }
  let uri = await SecureStore.getItemAsync(KEY);
  const stored = Boolean(uri);
  if (!uri) {
    await chooseSaveFolder();
    uri = await SecureStore.getItemAsync(KEY);
    if (!uri) throw new UserCancelled();
  }
  return { dir: new Directory(uri), where: describeFolder(uri), stored };
}

/**
 * Copies a downloaded file from the app's temporary storage into the folder the person chose
 * (Android) or the app's Downloads folder (iPhone), and says where it went.
 */
export async function saveFile(localUri: string, name: string, retried = false): Promise<SaveResult> {
  const { File } = nextFs();
  const { dir, where, stored } = await targetFolder();

  try {
    const finalName = uniqueName(dir, name);
    let sourceUri = localUri;
    if (finalName !== name) {
      // A copy of the same name already exists there: give the temporary file the new name first.
      const FS = fileSystem();
      sourceUri = localUri.slice(0, localUri.lastIndexOf('/') + 1) + finalName;
      await FS.moveAsync({ from: localUri, to: sourceUri });
    }
    new File(sourceUri).copy(dir);

    let fileUri: string | null = null;
    try {
      fileUri = dir.list().find((e) => e.name === finalName)?.uri ?? null;
    } catch {
      // listing isn't possible: the file is saved, we just can't open it from here
    }
    const ext = finalName.includes('.') ? finalName.split('.').pop() ?? '' : '';
    return { where, fileName: finalName, folderUri: dir.uri, fileUri, mime: mimeFor(ext) };
  } catch (e) {
    if (e instanceof ApiError || e instanceof UserCancelled) throw e;
    if (stored && !retried && Platform.OS === 'android') {
      // The saved folder may have been deleted or its access taken away: ask again, once.
      await forgetSaveFolder();
      return saveFile(localUri, name, true);
    }
    throw new ApiError('server', `Couldn't save the file there (${String((e as { message?: string })?.message ?? e)}). Use Share, then Save to Files.`);
  }
}

// ---------- afterwards: open the file, show its folder ----------

/** Opens the saved file with the phone's own app for its type. */
export async function openSaved(result: SaveResult): Promise<void> {
  if (Platform.OS === 'android' && result.fileUri) {
    await intents().startActivityAsync('android.intent.action.VIEW', {
      data: result.fileUri,
      flags: 1,
      type: result.mime,
    });
    return;
  }
  if (result.fileUri) await Linking.openURL(result.fileUri);
}

/** Opens the Files app at the folder the file was saved in. */
export async function showFolder(result: SaveResult): Promise<void> {
  if (Platform.OS === 'android') {
    const m = /\/tree\/([^/?#]+)/.exec(result.folderUri);
    const data = m ? `content://com.android.externalstorage.documents/document/${m[1]}` : result.folderUri;
    await intents().startActivityAsync('android.intent.action.VIEW', {
      data,
      type: 'vnd.android.document/directory',
      flags: 1,
    });
    return;
  }
  await Linking.openURL('shareddocuments://' + result.folderUri.replace(/^file:\/\//, ''));
}