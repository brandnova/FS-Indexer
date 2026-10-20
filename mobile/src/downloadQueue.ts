import { useSyncExternalStore } from 'react';
import { ApiError } from './api/client';
import type { FileRow } from './db/queries';
import { saveFile } from './downloads';
import { downloadToCache, fileSystem, type FileDownload } from './files';
import { loadPairing } from './pairing';

export type DownloadStatus = 'queued' | 'downloading' | 'saving' | 'done' | 'failed' | 'cancelled';

export interface DownloadItem {
  id: string; // path@mtime: one entry per version of a file
  row: FileRow;
  status: DownloadStatus;
  progress: number; // 0..1 while downloading
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  error: string | null;
  savedAs: string | null;
  where: string | null;
  addedAt: number;
  finishedAt: number | null;
}

export interface DownloadSummary {
  total: number;
  active: number; // downloading or saving
  queued: number;
  done: number;
  failed: number;
  fraction: number; // 0..1 across everything not cancelled
  running: boolean;
}

const MAX_PARALLEL = 2;
const KEEP_DAYS = 30; // finished downloads are remembered this long...
const KEEP_MAX = 100; // ...and at most this many
const HISTORY_FILE = 'downloads-history.json';

/** When this run of the app started: the progress bar only shows downloads from this run. */
export const SESSION_START = Date.now();

let items: DownloadItem[] = [];
const listeners = new Set<() => void>();
const running = new Map<string, FileDownload>();

// ---------- history (a small file in the app's own storage) ----------

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function historyFile(): string | null {
  try {
    const dir = fileSystem().documentDirectory;
    return dir ? dir + HISTORY_FILE : null;
  } catch {
    return null; // a build without file support
  }
}

function recentFinished(list: DownloadItem[]): DownloadItem[] {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  return list
  .filter((i) => (i.status === 'done' || i.status === 'failed') && (i.finishedAt ?? i.addedAt) >= cutoff)
  .slice(-KEEP_MAX);
}

async function persistNow(): Promise<void> {
  const file = historyFile();
  if (!file) return;
  try {
    await fileSystem().writeAsStringAsync(file, JSON.stringify({ v: 1, items: recentFinished(items) }));
  } catch {
    // the history is a convenience
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 1500);
}

/** Loads earlier downloads (done or failed) from the history file. Called once when the app starts. */
export async function loadDownloadHistory(): Promise<void> {
  const file = historyFile();
  if (!file) return;
  try {
    const FS = fileSystem();
    const info = await FS.getInfoAsync(file);
    if (!info.exists) return;
    const data = JSON.parse(await FS.readAsStringAsync(file)) as { items?: DownloadItem[] };
    const known = new Set(items.map((i) => i.id));
    const old = recentFinished(
      Array.isArray(data.items) ? data.items.filter((i) => i && i.id && i.row && !known.has(i.id)) : [],
    );
    if (old.length > 0) emit([...old, ...items]);
  } catch {
    // an unreadable history is simply empty
  }
}
void loadDownloadHistory();

/** Forgets every download and the history (used when the PC is unpaired). */
export async function clearDownloads(): Promise<void> {
  cancelAllDownloads();
  emit([]);
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const file = historyFile();
  if (file) {
    try {
      await fileSystem().deleteAsync(file, { idempotent: true });
    } catch {
      // nothing to delete
    }
  }
}

// ---------- the store ----------

function emit(next: DownloadItem[]): void {
  items = next;
  listeners.forEach((l) => l());
  schedulePersist();
}

function update(id: string, patch: Partial<DownloadItem>): void {
  emit(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  if (patch.status === 'done' || patch.status === 'failed') void persistNow(); // don't wait for the timer
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getSnapshot = () => items;

export function useDownloads(): DownloadItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The queue entry for a file, if it has one. */
export function useDownloadFor(row: FileRow | null): DownloadItem | null {
  const all = useDownloads();
  if (!row) return null;
  return all.find((i) => i.row.path === row.path && i.row.mtime === row.mtime) ?? null;
}

export function summarize(list: DownloadItem[]): DownloadSummary {
  const counted = list.filter((i) => i.status !== 'cancelled');
  let totalBytes = 0;
  let doneBytes = 0;
  for (const i of counted) {
    const size = Math.max(1, i.row.size);
    totalBytes += size;
    if (i.status === 'done' || i.status === 'saving') doneBytes += size;
    else if (i.status === 'downloading') doneBytes += size * i.progress;
  }
  const active = list.filter((i) => i.status === 'downloading' || i.status === 'saving').length;
  const queued = list.filter((i) => i.status === 'queued').length;
  return {
    total: counted.length,
    active,
    queued,
    done: list.filter((i) => i.status === 'done').length,
    failed: list.filter((i) => i.status === 'failed').length,
    fraction: totalBytes > 0 ? doneBytes / totalBytes : 0,
    running: active + queued > 0,
  };
}

// ---------- actions ----------

/** Adds a file to the queue. Returns "exists" if it is already waiting or downloading. */
export function enqueueDownload(row: FileRow): 'added' | 'exists' {
  const id = `${row.path}@${row.mtime}`;
  const existing = items.find((i) => i.id === id);
  if (existing && (existing.status === 'queued' || existing.status === 'downloading' || existing.status === 'saving')) {
    return 'exists';
  }
  const fresh: DownloadItem = {
    id, row, status: 'queued', progress: 0, bytesPerSecond: null, etaSeconds: null,
    error: null, savedAs: null, where: null, addedAt: Date.now(), finishedAt: null,
  };
  emit([...items.filter((i) => i.id !== id), fresh]);
  pump();
  return 'added';
}

export function cancelDownload(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (item.status === 'downloading') running.get(id)?.cancel(); // run() marks it cancelled
  else if (item.status === 'queued') update(id, { status: 'cancelled', finishedAt: Date.now() });
}

export function cancelAllDownloads(): void {
  for (const i of items) cancelDownload(i.id);
}

export function retryDownload(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) return;
  update(id, { status: 'queued', progress: 0, error: null, bytesPerSecond: null, etaSeconds: null, finishedAt: null, addedAt: Date.now() });
  pump();
}

export function removeDownload(id: string): void {
  const item = items.find((i) => i.id === id);
  if (!item || item.status === 'downloading' || item.status === 'saving') return;
  emit(items.filter((i) => i.id !== id));
}

/** Clears saved and cancelled entries (failed ones stay so they can be retried). */
export function clearFinishedDownloads(): void {
  emit(items.filter((i) => i.status !== 'done' && i.status !== 'cancelled'));
}

// ---------- the engine ----------

function pump(): void {
  let free = MAX_PARALLEL - items.filter((i) => i.status === 'downloading' || i.status === 'saving').length;
  for (const it of items) {
    if (free <= 0) break;
    if (it.status === 'queued') {
      free--;
      void run(it.id);
    }
  }
}

async function removeCopy(uri: string): Promise<void> {
  try {
    // Every temporary copy lives in its own folder, which goes away with it.
    await fileSystem().deleteAsync(uri.slice(0, uri.lastIndexOf('/') + 1), { idempotent: true });
  } catch {
    // best effort
  }
}

async function run(id: string): Promise<void> {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  update(id, { status: 'downloading', progress: 0, error: null, bytesPerSecond: null, etaSeconds: null });

  const pairing = await loadPairing();
  if (!pairing || pairing.demo) {
    update(id, {
      status: 'failed',
      finishedAt: Date.now(),
           error: pairing ? "Downloads aren't available in the demo." : 'This phone is not paired with a PC.',
    });
    pump();
    return;
  }

  const size = Math.max(1, item.row.size);
  let lastEmit = 0;
  let lastTime = Date.now();
  let lastBytes = 0;
  let speed = 0;

  const d = downloadToCache(pairing, item.row, (fraction) => {
    const now = Date.now();
    if (now - lastEmit < 250 && fraction < 1) return; // a few updates a second are plenty
    const bytes = fraction * size;
    const seconds = (now - lastTime) / 1000;
    if (seconds > 0) {
      const instant = (bytes - lastBytes) / seconds;
      speed = speed > 0 ? speed * 0.7 + instant * 0.3 : instant; // smoothed
    }
    lastTime = now;
    lastBytes = bytes;
    lastEmit = now;
    update(id, {
      progress: fraction,
      bytesPerSecond: speed > 0 ? speed : null,
      etaSeconds: speed > 0 ? Math.max(0, (size - bytes) / speed) : null,
    });
  });
  running.set(id, d);

  try {
    const uri = await d.promise;
    update(id, { status: 'saving', progress: 1, bytesPerSecond: null, etaSeconds: null });
    const saved = await saveFile(uri, item.row.name);
    await removeCopy(uri); // the saved copy is the only one that stays
    update(id, { status: 'done', savedAs: saved.fileName, where: saved.where, finishedAt: Date.now() });
  } catch (e) {
    if (d.cancelled()) update(id, { status: 'cancelled', finishedAt: Date.now() });
    else update(id, { status: 'failed', finishedAt: Date.now(), error: e instanceof ApiError ? e.message : "Couldn't finish this download." });
  } finally {
    running.delete(id);
    pump();
  }
}
