import type { SQLiteDatabase } from 'expo-sqlite';
import { ApiError, apiRequest, ping } from './api/client';
import { getDb, getMeta, setMeta } from './db';
import type { Candidate, Entry, PairingInfo } from './types';

export interface SyncProgress {
  phase: 'rescanning' | 'downloading' | 'cleaning';
  received: number;
  total: number | null;
}

export interface SyncResult {
  total: number;
  removed: number;
  ms: number;
}

const ROWS_PER_STATEMENT = 100; // 9 params per row = 900, under SQLite's classic 999 limit
const ROWS_PER_TRANSACTION = 1000;
const READ_STALL_MS = 15_000; // give up if the PC stops sending data for this long
const COLUMNS = '(path, parent, name, name_lc, ext, size, mtime, is_dir, sync_id)';
const ROW_PLACEHOLDER = '(?, ?, ?, ?, ?, ?, ?, ?, ?)';

export async function syncFromPc(
  pairing: PairingInfo,
  opts: { rescan?: boolean; onProgress?: (p: SyncProgress) => void } = {},
): Promise<SyncResult> {
  const { rescan = false, onProgress } = opts;
  const started = Date.now();

  if (rescan) {
    onProgress?.({ phase: 'rescanning', received: 0, total: null });
    await rescanRemote(pairing);
  }

  const db = await getDb();

  // Saved BEFORE downloading: rows written by a failed sync must never share
  // an id with the next attempt, or their stale rows would survive cleanup.
  const syncId = Number((await getMeta('sync_id')) ?? '0') + 1;
  await setMeta('sync_id', String(syncId));

  const total = await downloadIndex(pairing, db, syncId, onProgress);

  // Only reached after a complete download: anything not touched by this
  // sync no longer exists on the PC.
  onProgress?.({ phase: 'cleaning', received: total, total });
  const res = await db.runAsync('DELETE FROM files WHERE sync_id != ?', syncId);
  await setMeta('last_synced_at', String(Math.floor(Date.now() / 1000)));

  return { total, removed: res.changes, ms: Date.now() - started };
}

// ---------- download ----------

async function downloadIndex(
  c: Candidate,
  db: SQLiteDatabase,
  syncId: number,
  onProgress?: (p: SyncProgress) => void,
): Promise<number> {
  const res = await apiRequest(c, '/index', { timeoutMs: 10_000 });

  const header = res.headers.get('X-File-Count');
  const total = header ? Number(header) : null;
  if (total === 0) {
    throw new ApiError('server', "The PC has no index yet. Wait for its first scan to finish, then try again.");
  }
  if (!res.body) throw new ApiError('server');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let carry: Uint8Array = new Uint8Array(0); // bytes of a partial line from the previous chunk
  let batch: Entry[] = [];
  let received = 0;

  const handleLine = (line: string) => {
    if (!line) return;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isEntry(parsed)) batch.push(parsed);
    } catch {
      // malformed line: skipped, caught by the count check at the end
    }
  };

  const flush = async () => {
    if (batch.length === 0) return;
    await insertBatch(db, batch, syncId);
    received += batch.length;
    batch = [];
    onProgress?.({ phase: 'downloading', received, total });
  };

  try {
    while (true) {
      const { done, value } = await readWithTimeout(reader);
      if (done) break;
      if (!value || value.length === 0) continue;

      const bytes = carry.length ? concat(carry, value) : value;

      // Split on the newline BYTE (10) so multi-byte characters are never cut.
      const lastNl = bytes.lastIndexOf(10);
      if (lastNl === -1) {
        carry = bytes.slice();
        continue;
      }

      const text = decoder.decode(bytes.slice(0, lastNl));
      for (const line of text.split('\n')) handleLine(line);
      carry = bytes.slice(lastNl + 1);

      if (batch.length >= ROWS_PER_TRANSACTION) await flush();
    }

    if (carry.length) handleLine(decoder.decode(carry));
    await flush();
  } finally {
    reader.cancel().catch(() => {});
  }

  if (total !== null && received !== total) {
    throw new ApiError('server', 'The download was incomplete. Your existing index was kept; try syncing again.');
  }
  return received;
}

async function insertBatch(db: SQLiteDatabase, entries: Entry[], syncId: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < entries.length; i += ROWS_PER_STATEMENT) {
      const slice = entries.slice(i, i + ROWS_PER_STATEMENT);
      const params: (string | number)[] = [];
      for (const e of slice) {
        params.push(e.path, e.parent, e.name, e.name.toLowerCase(), e.ext, e.size, e.mtime, e.is_dir ? 1 : 0, syncId);
      }
      const placeholders = new Array(slice.length).fill(ROW_PLACEHOLDER).join(', ');
      await db.runAsync(`INSERT OR REPLACE INTO files ${COLUMNS} VALUES ${placeholders}`, params);
    }
  });
}

// ---------- rescan ----------

async function rescanRemote(c: Candidate): Promise<void> {
  // 409 means a scan is already running, which is fine: we just wait for it.
  await apiRequest(c, '/reindex', { method: 'POST', allow: [409] });

  // The agent sets `scanning` before answering and clears it only after the
  // new snapshot is in place, so `scanning: false` means the data is fresh.
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(500);
    if (!(await ping(c)).scanning) return;
  }
  throw new ApiError('timeout', 'The PC is taking too long to rescan.');
}

// ---------- helpers ----------

interface ByteReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

function readWithTimeout(reader: ByteReader): Promise<{ done: boolean; value?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError('timeout', 'The PC stopped sending data.')), READ_STALL_MS);
    reader.read().then(
      (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEntry(x: unknown): x is Entry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.path === 'string' &&
    typeof e.parent === 'string' &&
    typeof e.name === 'string' &&
    typeof e.ext === 'string' &&
    typeof e.size === 'number' &&
    typeof e.mtime === 'number' &&
    typeof e.is_dir === 'boolean'
  );
}