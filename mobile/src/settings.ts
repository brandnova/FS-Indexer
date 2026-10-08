import { getMeta, setMeta } from './db';

// Keys starting with "setting:" survive unpairing (see clearIndex in db/index.ts).
const AUTO_SYNC_KEY = 'setting:auto_sync';
const THEME_KEY = 'setting:theme';

export type ThemeMode = 'light' | 'dark';

/** Update when opening the app. On unless the user switched it off. */
export async function getAutoSync(): Promise<boolean> {
  return (await getMeta(AUTO_SYNC_KEY)) !== '0';
}

export async function setAutoSync(on: boolean): Promise<void> {
  await setMeta(AUTO_SYNC_KEY, on ? '1' : '0');
}

/** Light unless the user chose dark. */
export async function getThemeMode(): Promise<ThemeMode> {
  return (await getMeta(THEME_KEY)) === 'dark' ? 'dark' : 'light';
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await setMeta(THEME_KEY, mode);
}