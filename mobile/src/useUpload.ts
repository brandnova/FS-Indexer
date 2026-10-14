import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, ping, toApiError } from './api/client';
import { loadPairing } from './pairing';
import type { PairingInfo } from './types';
import { deletePicked, pickFiles, uploadFile, type PickedFile, type Upload } from './upload';

export type UploadAccess = 'checking' | 'ready' | 'off' | 'old' | 'demo' | 'error';

export interface UploadItem {
  id: number;
  name: string;
  size: number | null;
  status: 'waiting' | 'sending' | 'done' | 'failed';
  progress: number; // 0..1
  message: string | null;
  savedAs: string | null;
}

export interface UploadState {
  access: UploadAccess;
  notice: string | null;
  maxMb: number | null;
  items: UploadItem[];
  running: boolean;
  error: string | null;
  choose: () => void;
  cancel: () => void;
}

/** Whether the PC takes files, and the queue of files being sent. Closing the sheet cancels the sending. */
export function useUpload(visible: boolean): UploadState {
  const [access, setAccess] = useState<UploadAccess>('checking');
  const [notice, setNotice] = useState<string | null>(null);
  const [maxMb, setMaxMb] = useState<number | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pairing = useRef<PairingInfo | null>(null);
  const current = useRef<Upload | null>(null);
  const stopRequested = useRef(false);
  const nextId = useRef(1);

  useEffect(() => {
    if (!visible) return undefined;
    setItems([]);
    setError(null);
    setRunning(false);
    setAccess('checking');
    setNotice(null);
    setMaxMb(null);
    stopRequested.current = false;
    let stale = false;

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
        setNotice("Sending files isn't available in the demo, because there is no PC.");
        return;
      }
      try {
        const info = await ping(p);
        if (stale) return;
        if (info.uploads === undefined) {
          setAccess('old');
          setNotice("The agent on your PC is older than this app and can't receive files. Update the agent.");
        } else if (!info.uploads) {
          setAccess('off');
          setNotice('Receiving files is switched off on your PC. To turn it on, open the agent\'s dashboard, go to Settings, and switch on "Receive files from my phone".');
        } else {
          setMaxMb(info.upload_max_mb ?? null);
          setAccess('ready');
        }
      } catch (e) {
        if (stale) return;
        setAccess('error');
        setNotice(toApiError(e).message);
      }
    })();

    return () => {
      stale = true;
      stopRequested.current = true;
      current.current?.cancel();
    };
  }, [visible]);

  const update = useCallback((id: number, patch: Partial<UploadItem>) => {
    setItems((all) => all.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const choose = useCallback(async () => {
    const p = pairing.current;
    if (!p || running) return;
    setError(null);

    let picked: PickedFile[];
    try {
      picked = await pickFiles();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't open the file picker.");
      return;
    }
    if (picked.length === 0) return;

    const queue = picked.map((file) => ({ id: nextId.current++, file }));
    setItems((all) => [
      ...all,
      ...queue.map(({ id, file }) => ({
        id, name: file.name, size: file.size, status: 'waiting' as const, progress: 0, message: null, savedAs: null,
      })),
    ]);
    stopRequested.current = false;
    setRunning(true);

    let aborted = false;
    for (const { id, file } of queue) {
      if (aborted || stopRequested.current) {
        update(id, { status: 'failed', message: 'Not sent.' });
        await deletePicked(file.uri);
        continue;
      }
      if (maxMb && file.size && file.size > maxMb * 1024 * 1024) {
        update(id, { status: 'failed', message: `Too large: your PC accepts files up to ${maxMb} MB.` });
        await deletePicked(file.uri);
        continue;
      }

      update(id, { status: 'sending', progress: 0 });
      const up = uploadFile(p, file, (fraction) => update(id, { progress: fraction }));
      current.current = up;
      try {
        const res = await up.promise;
        update(id, { status: 'done', progress: 1, savedAs: res.name });
      } catch (e) {
        const err = e instanceof ApiError ? e : toApiError(e);
        update(id, { status: 'failed', message: err.message });
        // Problems that would repeat for every file end the whole batch.
        if (err.kind === 'unauthorized' || err.kind === 'forbidden' || err.isConnectivity) aborted = true;
      } finally {
        current.current = null;
        await deletePicked(file.uri);
      }
    }
    setRunning(false);
  }, [running, maxMb, update]);

  const cancel = useCallback(() => {
    stopRequested.current = true;
    current.current?.cancel();
  }, []);

  return {
    access,
    notice,
    maxMb,
    items,
    running,
    error,
    choose: () => void choose(),
    cancel,
  };
}