import { getMeta, setMeta } from './db';

// Keys starting with "setting:" survive unpairing (see clearIndex in db/index.ts).
const AUTO_SYNC_KEY = 'setting:auto_sync';

/** Sync when opening the app. On unless the user switched it off. */
export async function getAutoSync(): Promise<boolean> {
  return (await getMeta(AUTO_SYNC_KEY)) !== '0';
}

export async function setAutoSync(on: boolean): Promise<void> {
  await setMeta(AUTO_SYNC_KEY, on ? '1' : '0');
}