import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, ping, toApiError } from './api/client';
import type { FileRow } from './db/queries';
import { chooseSaveFolder, getSaveFolderLabel, openSaved, saveFile, showFolder, UserCancelled, type SaveResult } from './downloads';
import {
  authHeaders,
  downloadToCache,
  fetchTextPreview,
  fileUrl,
  openFile,
  previewKind,
  shareFile,
  type FileDownload,
} from './files';
import { loadPairing } from './pairing';
import type { PairingInfo } from './types';

export type FileAccess = 'none' | 'checking' | 'ready' | 'off' | 'old' | 'demo' | 'error';
export type FileJob = 'open' | 'share' | 'download';

export interface SavedInfo {
  where: string;
  fileName: string;
  open: () => void;
  show: () => void;
}

export interface FileActions {
  access: FileAccess;
  notice: string | null; // why files can't be opened right now
  error: string | null; // what went wrong with the last action
  image: { uri: string; headers: Record<string, string> } | null;
  text: string | null;
  busy: FileJob | null;
  progress: number | null; // 0..1 while copying
  saved: SavedInfo | null; // set after a download
  openedTemp: boolean; // the last Open used a temporary copy
  saveFolder: string | null; // where downloads go (null until chosen on Android)
  open: () => void;
  share: () => void;
  download: () => void;
  changeFolder: () => void;
}

/**
 * Everything the details sheet needs to work with a file: does the PC allow it, a preview, and the
 * Open, Share and Download actions. Closing the sheet (or picking another file) cancels a copy in progress.
 */
export function useFileActions(row: FileRow | null): FileActions {
  const [access, setAccess] = useState<FileAccess>('none');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<FileActions['image']>(null);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState<FileJob | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [openedTemp, setOpenedTemp] = useState(false);
  const [saveFolder, setSaveFolder] = useState<string | null>(null);
  const pairing = useRef<PairingInfo | null>(null);
  const download = useRef<FileDownload | null>(null);

  const path = row?.path ?? null;
  const mtime = row?.mtime ?? 0;
  const isDir = row?.isDir ?? false;

  useEffect(() => {
    setAccess('none');
    setNotice(null);
    setError(null);
    setImage(null);
    setText(null);
    setBusy(null);
    setProgress(null);
    setSaved(null);
    setOpenedTemp(false);
    if (!row || isDir) return undefined;

    const file: FileRow = row;
    let stale = false;

    void getSaveFolderLabel().then((label) => {
      if (!stale) setSaveFolder(label);
    });

    void (async () => {
      const p = await loadPairing();
      if (stale) return;
      pairing.current = p;

      if (!p) {
        setAccess('error');
        setNotice('This phone is not paired with a PC.');
        return;
      }
      if (p.demo) {
        setAccess('demo');
        setNotice("Opening files isn't available in the demo, because there is no PC.");
        return;
      }

      setAccess('checking');
      try {
        const info = await ping(p);
        if (stale) return;
        if (info.file_access === undefined) {
          setAccess('old');
          setNotice("The agent on your PC is older than this app and can't send files. Update the agent to open files.");
          return;
        }
        if (!info.file_access) {
          setAccess('off');
          setNotice('Opening files is switched off on your PC. To turn it on, open the agent\'s dashboard, go to Settings and switch on "Open and download files".');
          return;
        }
        setAccess('ready');
      } catch (e) {
        if (stale) return;
        setAccess('error');
        setNotice(toApiError(e).message);
        return;
      }

      const kind = previewKind(file);
      if (kind === 'image') setImage({ uri: fileUrl(p, file), headers: authHeaders(p) });
      if (kind === 'text') {
        try {
          const preview = await fetchTextPreview(p, file);
          if (!stale) setText(preview);
        } catch {
          // a preview is optional
        }
      }
    })();

    return () => {
      stale = true;
      download.current?.cancel();
    };
    // The effect depends on which file (and which version of it) is showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, mtime, isDir]);

  const run = useCallback(
    async (job: FileJob) => {
      const p = pairing.current;
      if (!p || !row || download.current) return;

      setBusy(job);
      setProgress(0);
      setError(null);
      if (job === 'download') setSaved(null);
      const d = downloadToCache(p, row, setProgress);
      download.current = d;
      try {
        const uri = await d.promise;
        if (job === 'open') {
          await openFile(uri, row);
          setOpenedTemp(true);
        } else if (job === 'share') {
          await shareFile(uri, row);
        } else {
          setProgress(1);
          const result = await saveFile(uri, row.name);
          setSaved(result);
          setSaveFolder(result.where);
        }
      } catch (e) {
        if (e instanceof UserCancelled) {
          // the person closed the folder picker: nothing to report
        } else if (!d.cancelled()) {
          setError(e instanceof ApiError ? e.message : "Couldn't finish that.");
        }
      } finally {
        download.current = null;
        setBusy(null);
        setProgress(null);
      }
    },
    [row],
  );

  const changeFolder = useCallback(async () => {
    try {
      const label = await chooseSaveFolder();
      if (label) setSaveFolder(label);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't open the folder picker.");
    }
  }, []);

  return {
    access,
    notice,
    error,
    image,
    text,
    busy,
    progress,
    saved: saved
      ? {
          where: saved.where,
          fileName: saved.fileName,
          open: () => void openSaved(saved).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't open the saved file.")),
          show: () => void showFolder(saved).catch(() => setError(`Open your Files app and look in: ${saved.where}`)),
        }
      : null,
    openedTemp,
    saveFolder,
    open: () => void run('open'),
    share: () => void run('share'),
    download: () => void run('download'),
    changeFolder: () => void changeFolder(),
  };
}