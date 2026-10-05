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

/** Children of a folder. Pass '' to list the roots. Folders first, then A-Z. */
export async function listFolder(parent: string): Promise<FileRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>(
    `SELECT ${COLUMNS} FROM files WHERE parent = ? ORDER BY is_dir DESC, name_lc ASC`,
    parent,
  );
  return rows.map(toRow);
}

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