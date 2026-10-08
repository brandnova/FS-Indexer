import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Opens the database once and returns the shared handle. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate().catch((e) => {
      dbPromise = null; // allow a retry
      throw e;
    });
  }
  return dbPromise;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('fsindex.db');
  await db.execAsync('PRAGMA journal_mode = WAL;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  // Version 1: the file index and a small key/value table.
  if (current < 1) {
    // WITHOUT ROWID: the path IS the primary key, so we don't store it twice.
    // No index on name_lc: substring LIKE '%x%' can't use one anyway.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS files (
        path    TEXT PRIMARY KEY NOT NULL,
        parent  TEXT NOT NULL,
        name    TEXT NOT NULL,
        name_lc TEXT NOT NULL,
        ext     TEXT NOT NULL,
        size    INTEGER NOT NULL,
        mtime   INTEGER NOT NULL,
        is_dir  INTEGER NOT NULL,
        sync_id INTEGER NOT NULL
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent);

      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `);
  }

  // Version 2: pinned folders.
  if (current < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS pins (
        path      TEXT PRIMARY KEY NOT NULL,
        pinned_at INTEGER NOT NULL
      );

      PRAGMA user_version = 2;
    `);
  }

  return db;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

export async function countEntries(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM files');
  return row?.n ?? 0;
}

/**
 * Wipes everything that belongs to one PC (used when unpairing or switching PCs).
 * Settings (keys starting with "setting:") belong to the app and are kept.
 */
export async function clearIndex(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM files');
    await db.runAsync('DELETE FROM pins');
    await db.runAsync("DELETE FROM meta WHERE key NOT LIKE 'setting:%'");
  });
}