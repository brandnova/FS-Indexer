import { apiRequest } from './api/client';
import { getMeta, setMeta } from './db';
import type { Candidate } from './types';

// Stored in the per-PC meta table, so unpairing wipes it with the rest.
const KEY = 'pc_roots';

interface PcRoots {
  sep: string; // the PC's path separator: "/" or "\"
  roots: { label: string; path: string }[];
}

/**
 * Asks the agent where its folders live on the PC and remembers the answer.
 * Agents from before this existed don't have the endpoint: that's fine, PC
 * paths simply aren't offered.
 */
export async function refreshPcRoots(c: Candidate): Promise<void> {
  try {
    const res = await apiRequest(c, '/roots');
    const body = (await res.json()) as PcRoots;
    if (typeof body?.sep === 'string' && Array.isArray(body.roots)) {
      await setMeta(KEY, JSON.stringify(body));
    }
  } catch {
    // Older agent, or the PC is offline right now. Keep what we have.
  }
}

async function loadPcRoots(): Promise<PcRoots | null> {
  const raw = await getMeta(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PcRoots;
  } catch {
    return null;
  }
}

/** Joins a root folder and a "/"-separated remainder using the PC's own separator. */
export function joinPcPath(root: string, rest: string, sep: string): string {
  if (!rest) return root;
  const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root;
  const tail = sep === '/' ? rest : rest.split('/').join(sep);
  return `${base}${sep}${tail}`;
}

/** The full path on the PC for an app path like "Documents/cv/resume.pdf", or null if unknown. */
export async function fullPcPath(appPath: string): Promise<string | null> {
  const info = await loadPcRoots();
  if (!info) return null;

  const slash = appPath.indexOf('/');
  const label = slash === -1 ? appPath : appPath.slice(0, slash);
  const rest = slash === -1 ? '' : appPath.slice(slash + 1);

  const root = info.roots.find((r) => r.label === label);
  return root ? joinPcPath(root.path, rest, info.sep) : null;
}