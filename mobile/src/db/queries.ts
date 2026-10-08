import { getDb } from './index';

export interface FileRow {
  path: string;
  parent: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  isDir: boolean;
}

interface RawRow {
  path: string;
  parent: string;
  name: string;
  ext: string;
  size: number;
  mtime: number;
  is_dir: number;
}

const COLUMNS = 'path, parent, name, ext, size, mtime, is_dir';

function toRow(r: RawRow): FileRow {
  return {
    path: r.path,
    parent: r.parent,
    name: r.name,
    ext: r.ext,
    size: r.size,
    mtime: r.mtime,
    isDir: r.is_dir === 1,
  };
}

// ---------- browsing ----------

/** Children of a folder. Pass '' to list the roots. Folders first, then A-Z. */
export async function listFolder(parent: string): Promise<FileRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>(
    `SELECT ${COLUMNS} FROM files WHERE parent = ? ORDER BY is_dir DESC, name_lc ASC`,
    parent,
  );
  return rows.map(toRow);
}

/** The most recently modified files, newest first. */
export async function listRecent(limit = 100): Promise<FileRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>(
    `SELECT ${COLUMNS} FROM files WHERE is_dir = 0 ORDER BY mtime DESC LIMIT ?`,
    limit,
  );
  return rows.map(toRow);
}

// ---------- pinned folders ----------

/** Pinned folders that still exist in the index, most recently pinned first. */
export async function listPinned(): Promise<FileRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>(
    `SELECT f.path, f.parent, f.name, f.ext, f.size, f.mtime, f.is_dir
       FROM pins p JOIN files f ON f.path = p.path
      ORDER BY p.pinned_at DESC`,
  );
  return rows.map(toRow);
}

export async function isPinned(path: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pins WHERE path = ?', path);
  return (row?.n ?? 0) > 0;
}

export async function setPinned(path: string, pinned: boolean): Promise<void> {
  const db = await getDb();
  if (pinned) {
    await db.runAsync('INSERT OR REPLACE INTO pins (path, pinned_at) VALUES (?, ?)', path, Math.floor(Date.now() / 1000));
  } else {
    await db.runAsync('DELETE FROM pins WHERE path = ?', path);
  }
}

// ---------- summary ----------

export interface RootStat {
  root: string;
  files: number;
  bytes: number;
}

/** File count and total size per root folder. */
export async function rootStats(): Promise<RootStat[]> {
  const db = await getDb();
  return db.getAllAsync<RootStat>(
    `SELECT substr(path, 1, instr(path || '/', '/') - 1) AS root,
            SUM(CASE WHEN is_dir = 0 THEN 1 ELSE 0 END) AS files,
            COALESCE(SUM(size), 0) AS bytes
       FROM files
      GROUP BY root
      ORDER BY root COLLATE NOCASE`,
  );
}

// ---------- search ----------

export const SEARCH_LIMIT = 200;

/** Splits a query into lowercase words. */
export function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every word must appear somewhere in the name (any order, case-insensitive).
 * Shorter names rank first, which tends to put closer matches on top.
 */
export async function searchFiles(query: string, limit = SEARCH_LIMIT): Promise<FileRow[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const where = tokens.map(() => "name_lc LIKE ? ESCAPE '\\'").join(' AND ');
  // Escape LIKE wildcards so typing "%" or "_" searches for the literal character.
  const params: (string | number)[] = tokens.map((t) => `%${t.replace(/[\\%_]/g, '\\$&')}%`);
  params.push(limit);

  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>(
    `SELECT ${COLUMNS} FROM files WHERE ${where} ORDER BY length(name_lc), name_lc LIMIT ?`,
    params,
  );
  return rows.map(toRow);
}