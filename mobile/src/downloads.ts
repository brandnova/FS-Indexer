import { Linking, PermissionsAndroid, Platform } from 'react-native';
import { ApiError } from './api/client';
import { mimeFor, openFile } from './files';

const ANDROID_WHERE = 'Downloads';
const IOS_WHERE = 'Files app › On My iPhone › this app › Downloads';
const MISSING = "This build of the app can't save files yet. Install the newest build of the app.";

type IntentModule = typeof import('expo-intent-launcher');
type FileAccessModule = typeof import('react-native-file-access');

// iPhone only: the app's own Downloads folder, which the Files app shows. The new
// expo-file-system API is described loosely so a small difference shows up as a message in the sheet.
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
  Directory: new (...parts: unknown[]) => DirLike;
  File: new (...parts: unknown[]) => FileLike;
  Paths: { document: unknown };
}

function intents(): IntentModule {
  try {
    return require('expo-intent-launcher') as IntentModule;
  } catch {
    throw new ApiError('incompatible', MISSING);
  }
}

// Loaded when first needed, so a build without it still runs and says what to install.
function fileAccess(): FileAccessModule {
  try {
    return require('react-native-file-access') as FileAccessModule;
  } catch {
    throw new ApiError('incompatible', MISSING);
  }
}

function extOf(name: string): string {
  return name.includes('.') ? (name.split('.').pop() ?? '') : '';
}

const reason = (e: unknown) => String((e as { message?: string })?.message ?? e).replace(/\s+/g, ' ').trim();

/** Where a download goes, in words. */
export function saveLocation(): string {
  return Platform.OS === 'ios' ? IOS_WHERE : ANDROID_WHERE;
}

/** Android 9 and older need the storage permission to write into Downloads; newer versions need none. */
async function allowedToWriteDownloads(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) >= 29) return true;
  const answer = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE, {
    title: 'Save files to Downloads',
    message: 'Android 9 and older need your permission before an app can save files in Downloads.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return answer === PermissionsAndroid.RESULTS.GRANTED;
}

/** Opens the Downloads app (Android) or the Files app (iPhone). */
export async function openDownloadsFolder(): Promise<void> {
  if (Platform.OS === 'android') {
    await intents().startActivityAsync('android.intent.action.VIEW_DOWNLOADS');
    return;
  }
  await Linking.openURL('shareddocuments://');
}

export interface SaveResult {
  where: string; // the folder, in words
  fileName: string; // the name it was saved under
  fileUri: string | null; // null on Android: Android doesn't tell us where the file went inside Downloads
  mime: string;
}

// ---------- saving ----------

/** Copies a downloaded file from the app's temporary storage into the phone's Downloads. */
export async function saveFile(localUri: string, name: string): Promise<SaveResult> {
  const mime = mimeFor(extOf(name));

  if (Platform.OS === 'android') {
    if (!(await allowedToWriteDownloads())) {
      throw new ApiError('server', 'To save files on this version of Android, allow storage access when asked. You can also use Share to send the file to another app.');
    }
    const { FileSystem } = fileAccess();
    const path = decodeURIComponent(localUri.replace(/^file:\/\//, ''));
    try {
      await FileSystem.cpExternal(path, name, 'downloads'); // streamed into the public Downloads folder
      return { where: ANDROID_WHERE, fileName: name, fileUri: null, mime };
    } catch (e) {
      throw new ApiError('server', `Couldn't save the file (${reason(e)}). You can still use Share to send it to Drive or another app.`);
    }
  }
  return saveOnIphone(localUri, name, mime);
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

async function saveOnIphone(localUri: string, name: string, mime: string): Promise<SaveResult> {
  let fs: NextFs;
  try {
    fs = require('expo-file-system') as unknown as NextFs;
  } catch {
    throw new ApiError('incompatible', MISSING);
  }
  try {
    const dir = new fs.Directory(fs.Paths.document, 'Downloads');
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch {
      // it already exists
    }
    const finalName = uniqueName(dir, name);
    let sourceUri = localUri;
    if (finalName !== name) {
      // A copy of that name already exists: give the temporary file the new name first.
      const FS = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
      sourceUri = localUri.slice(0, localUri.lastIndexOf('/') + 1) + finalName;
      await FS.moveAsync({ from: localUri, to: sourceUri });
    }
    new fs.File(sourceUri).copy(dir);
    let fileUri: string | null = null;
    try {
      fileUri = dir.list().find((e) => e.name === finalName)?.uri ?? null;
    } catch {
      // the file is saved; it just can't be opened from here
    }
    return { where: IOS_WHERE, fileName: finalName, fileUri, mime };
  } catch (e) {
    throw new ApiError('server', `Couldn't save the file (${reason(e)}). Use Share, then Save to Files.`);
  }
}

// ---------- afterwards: open the file, show where it is ----------

/** Opens the saved file with the phone's own app for its type (iPhone; on Android use the Downloads app). */
export async function openSaved(result: SaveResult): Promise<void> {
  if (!result.fileUri) throw new ApiError('server', `Open it from the Downloads app: ${result.where}.`);
  await openFile(result.fileUri, { ext: extOf(result.fileName), name: result.fileName });
}

/** Opens the Downloads app (Android) or the Files app (iPhone). */
export async function showFolder(result: SaveResult): Promise<void> {
  if (Platform.OS === 'android') {
    await intents().startActivityAsync('android.intent.action.VIEW_DOWNLOADS');
    return;
  }
  await Linking.openURL('shareddocuments://' + (result.fileUri ?? '').replace(/^file:\/\//, '').replace(/\/[^/]*$/, ''));
}