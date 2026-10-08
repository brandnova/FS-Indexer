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

// ---------- filters and sorting ----------

export type SortKey = 'default' | 'name' | 'name_desc' | 'newest' | 'oldest' | 'largest' | 'smallest';
export type SearchScope = 'all' | 'names'; // names + folder names, or file/folder names only

export interface FilterSpec {
  exts?: string[]; // only files with these extensions
  modifiedAfter?: number; // unix seconds
  minSize?: number; // bytes
  sort?: SortKey;
}

const ORDER: Record<Exclude<SortKey, 'default'>, string> = {
  name: 'name_lc ASC',
  name_desc: 'name_lc DESC',
  newest: 'mtime DESC, name_lc ASC',
  oldest: 'mtime ASC, name_lc ASC',
  largest: 'size DESC, name_lc ASC',
  smallest: 'size ASC, name_lc ASC',
};

function orderFor(sort: SortKey | undefined, fallback: Exclude<SortKey, 'default'>): string {
  return ORDER[sort && sort !== 'default' ? sort : fallback];
}

/** Conditions that only make sense for files (type, date, size). */
function fileConditions(f: FilterSpec): { sql: string[]; params: (string | number)[] } {
  const sql: string[] = [];
  const params: (string | number)[] = [];
  if (f.exts && f.exts.length > 0) {
    sql.push(`ext IN (${f.exts.map(() => '?').join(', ')})`);
    params.push(...f.exts);
  }
  if (f.modifiedAfter) {
    sql.push('mtime >= ?');
    params.push(f.modifiedAfter);
  }
  if (f.minSize) {
    sql.push('size >= ?');
    params.push(f.minSize);
  }
  return { sql, params };
}

export function hasFileFilters(f: FilterSpec): boolean {
  return fileConditions(f).sql.length > 0;
}

// ---------- browsing ----------

/** Children of a folder. Pass '' to list the roots. Folders stay visible whatever the filters. */
export async function listFolder(parent: string, f: FilterSpec = {}): Promise<FileRow[]> {
  const { sql, params } = fileConditions(f);
  const where = ['parent = ?'];
  const args: (string | number)[] = [parent];
  if (sql.length > 0) {
    where.push(`(is_dir = 1 OR (${sql.join(' AND ')}))`);
    args.push(...params);
  }

  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>(
    `SELECT ${COLUMNS} FROM files WHERE ${where.join(' AND ')} ORDER BY is_dir DESC, ${orderFor(f.sort, 'name')}`,
    args,
  );
  return rows.map(toRow);
}

/** Files only, newest first unless another sort is chosen. */
export async function listRecent(f: FilterSpec = {}, limit = 100): Promise<FileRow[]> {
  const { sql, params } = fileConditions(f);
  const where = ['is_dir = 0', ...sql];

  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>(
    `SELECT ${COLUMNS} FROM files WHERE ${where.join(' AND ')} ORDER BY ${orderFor(f.sort, 'newest')} LIMIT ?`,
    [...params, limit],
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

// Escape LIKE wildcards so typing "%" or "_" searches for the literal character.
const likePattern = (token: string) => `%${token.replace(/[\\%_]/g, '\\$&')}%`;

const likeAll = (column: string, count: number) =>
  Array.from({ length: count }, () => `${column} LIKE ? ESCAPE '\\'`).join(' AND ');

/**
 * Every word must appear (any order, case-insensitive): in the file/folder name
 * ('names'), or anywhere in the full path ('all'). In 'all' mode, files whose
 * own name matches come first.
 */
export async function searchFiles(
  query: string,
  opts: { scope?: SearchScope; filters?: FilterSpec; limit?: number } = {},
): Promise<FileRow[]> {
  const { scope = 'all', filters = {}, limit = SEARCH_LIMIT } = opts;
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const likes = tokens.map(likePattern);
  const nameMatch = likeAll('name_lc', tokens.length);

  const where: string[] = [scope === 'all' ? likeAll('path_lc', tokens.length) : nameMatch];
  const args: (string | number)[] = [...likes];

  const { sql, params } = fileConditions(filters);
  if (sql.length > 0) {
    where.push('is_dir = 0', ...sql);
    args.push(...params);
  }

  // Placeholders must stay in the same order as they appear in the SQL text.
  let orderBy: string;
  if (filters.sort && filters.sort !== 'default') {
    orderBy = ORDER[filters.sort];
  } else if (scope === 'all') {
    orderBy = `CASE WHEN ${nameMatch} THEN 0 ELSE 1 END, length(name_lc), name_lc`;
    args.push(...likes);
  } else {
    orderBy = 'length(name_lc), name_lc';
  }
  args.push(limit);

  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>(
    `SELECT ${COLUMNS} FROM files WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ?`,
    args,
  );
  return rows.map(toRow);
}