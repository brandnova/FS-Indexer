import { ApiError, baseUrl, toApiError } from './api/client';
import { authHeaders } from './files';
import type { Candidate } from './types';

type FileSystemModule = typeof import('expo-file-system/legacy');
type PickerModule = typeof import('expo-document-picker');

const MISSING = "This build of the app can't send files yet. Install the newest build of the app.";

// Native parts are loaded when first needed, so a build without them still runs.
function fileSystem(): FileSystemModule {
  try {
    return require('expo-file-system/legacy') as FileSystemModule;
  } catch {
    throw new ApiError('incompatible', MISSING);
  }
}

function picker(): PickerModule {
  try {
    return require('expo-document-picker') as PickerModule;
  } catch {
    throw new ApiError('incompatible', MISSING);
  }
}

export interface PickedFile {
  uri: string;
  name: string;
  size: number | null;
  mime: string | undefined;
}

/** Lets the person choose one or more files. The system picker copies them to the app's cache first. */
export async function pickFiles(): Promise<PickedFile[]> {
  const DocumentPicker = picker();
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? null, mime: a.mimeType }));
}

/** Removes the temporary copy the picker made. */
export async function deletePicked(uri: string): Promise<void> {
  try {
    await fileSystem().deleteAsync(uri, { idempotent: true });
  } catch {
    // best effort
  }
}

export interface UploadResult {
  name: string; // what the PC saved it as
  size: number;
}

export interface Upload {
  promise: Promise<UploadResult>;
  cancel: () => void;
}

function explainUpload(status: number, body: string): ApiError {
  let code = '';
  try {
    code = String((JSON.parse(body) as { error?: unknown }).error ?? '');
  } catch {
    // not JSON
  }
  switch (status) {
    case 401:
      return new ApiError('unauthorized');
    case 403:
      if (code === 'uploads_off') {
        return new ApiError('server', 'Receiving files is switched off on your PC. Turn it on in the dashboard, under Settings.');
      }
      if (code === 'pair_again') {
        return new ApiError('server', 'To send files, pair this phone again by scanning the QR code. (This phone was paired the old way.)');
      }
      return new ApiError('forbidden');
    case 413:
      return new ApiError('server', 'That file is bigger than your PC allows.');
    case 415:
      return new ApiError('server', "Your PC doesn't accept program files (like .exe or .sh).");
    case 429:
      return new ApiError('server', 'Your PC has reached its limit of files per hour. Try again later.');
    case 503:
      return new ApiError(
        'server',
        code === 'drop_folder_unavailable' ? "The drop folder on your PC can't be found." : 'The PC is busy. Try again in a moment.',
      );
    case 507:
      return new ApiError('server', "Your PC's disk is full.");
    default:
      return new ApiError('server', `The PC couldn't save the file (${status}).`);
  }
}

/** Sends one file to the PC's drop folder, streaming it from disk. */
export function uploadFile(c: Candidate, file: PickedFile, onProgress: (fraction: number) => void): Upload {
  let cancelled = false;
  let task: { cancelAsync: () => Promise<void> } | null = null;

  const promise = (async (): Promise<UploadResult> => {
    const FS = fileSystem();
    const t = FS.createUploadTask(
      `${baseUrl(c)}/upload`,
      file.uri,
      {
        httpMethod: 'POST',
        uploadType: FS.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          ...authHeaders(c),
          'X-File-Name': encodeURIComponent(file.name),
          'Content-Type': file.mime || 'application/octet-stream',
        },
      },
      (p) => {
        if (p.totalBytesExpectedToSend > 0) onProgress(Math.min(1, p.totalBytesSent / p.totalBytesExpectedToSend));
      },
    );
    task = t;

    let result;
    try {
      result = await t.uploadAsync();
    } catch (e) {
      throw cancelled ? new ApiError('network', 'Cancelled') : toApiError(e);
    }
    if (cancelled || !result) throw new ApiError('network', 'Cancelled');
    if (result.status !== 201) throw explainUpload(result.status, result.body);

    try {
      const body = JSON.parse(result.body) as { name?: unknown; size?: unknown };
      return {
        name: typeof body.name === 'string' ? body.name : file.name,
        size: typeof body.size === 'number' ? body.size : file.size ?? 0,
      };
    } catch {
      return { name: file.name, size: file.size ?? 0 };
    }
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      void task?.cancelAsync().catch(() => undefined);
    },
  };
}