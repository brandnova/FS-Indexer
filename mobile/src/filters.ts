import type { FilterSpec, SearchScope, SortKey } from './db/queries';
import { FILE_KINDS, extsForKinds } from './fileTypes';

export type ModifiedRange = 'any' | 'day' | 'week' | 'month' | 'year';
export type SizeRange = 'any' | '1mb' | '10mb' | '100mb';

/** What the user picked in the filter sheet. */
export interface FilterState {
  kinds: string[]; // ids from the file-type registry
  modified: ModifiedRange;
  size: SizeRange;
  sort: SortKey;
  scope: SearchScope;
}

export const DEFAULT_FILTERS: FilterState = { kinds: [], modified: 'any', size: 'any', sort: 'default', scope: 'all' };

const DAY = 24 * 60 * 60;

export const MODIFIED_OPTIONS: { key: ModifiedRange; label: string; seconds: number }[] = [
  { key: 'any', label: 'Any time', seconds: 0 },
  { key: 'day', label: 'Last 24 hours', seconds: DAY },
  { key: 'week', label: 'Last 7 days', seconds: 7 * DAY },
  { key: 'month', label: 'Last 30 days', seconds: 30 * DAY },
  { key: 'year', label: 'Last year', seconds: 365 * DAY },
];

const MB = 1024 * 1024;

export const SIZE_OPTIONS: { key: SizeRange; label: string; bytes: number }[] = [
  { key: 'any', label: 'Any size', bytes: 0 },
  { key: '1mb', label: '1 MB or more', bytes: MB },
  { key: '10mb', label: '10 MB or more', bytes: 10 * MB },
  { key: '100mb', label: '100 MB or more', bytes: 100 * MB },
];

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'name', label: 'Name A-Z' },
  { key: 'name_desc', label: 'Name Z-A' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'largest', label: 'Largest' },
  { key: 'smallest', label: 'Smallest' },
];

export const SCOPE_OPTIONS: { key: SearchScope; label: string }[] = [
  { key: 'all', label: 'Names & folders' },
  { key: 'names', label: 'Names only' },
];

/** Turns the UI state into what the database layer understands. */
export function toSpec(state: FilterState, nowMs: number = Date.now()): FilterSpec {
  const modified = MODIFIED_OPTIONS.find((o) => o.key === state.modified)?.seconds ?? 0;
  const minSize = SIZE_OPTIONS.find((o) => o.key === state.size)?.bytes ?? 0;

  return {
    exts: state.kinds.length > 0 ? extsForKinds(state.kinds) : undefined,
    modifiedAfter: modified > 0 ? Math.floor(nowMs / 1000) - modified : undefined,
    minSize: minSize > 0 ? minSize : undefined,
    sort: state.sort,
  };
}

/** How many settings differ from the defaults. */
export function activeCount(state: FilterState): number {
  return (
    (state.kinds.length > 0 ? 1 : 0) +
    (state.modified !== 'any' ? 1 : 0) +
    (state.size !== 'any' ? 1 : 0) +
    (state.sort !== 'default' ? 1 : 0) +
    (state.scope !== 'all' ? 1 : 0)
  );
}

/** A one-line summary like "Images, Audio · Last 7 days · Largest". */
export function describe(state: FilterState): string {
  const parts: string[] = [];
  if (state.kinds.length > 0) {
    parts.push(FILE_KINDS.filter((k) => state.kinds.includes(k.id)).map((k) => k.label).join(', '));
  }
  if (state.modified !== 'any') parts.push(MODIFIED_OPTIONS.find((o) => o.key === state.modified)?.label ?? '');
  if (state.size !== 'any') parts.push(SIZE_OPTIONS.find((o) => o.key === state.size)?.label ?? '');
  if (state.sort !== 'default') parts.push(`Sort: ${SORT_OPTIONS.find((o) => o.key === state.sort)?.label ?? ''}`);
  if (state.scope !== 'all') parts.push('Names only');
  return parts.join(' · ');
}