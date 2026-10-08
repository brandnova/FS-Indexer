export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString();
}

export function formatDateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}

/** "just now", "5 minutes ago", "yesterday", or a date for anything older. */
export function formatRelative(seconds: number, nowMs: number = Date.now()): string {
  const diff = Math.floor(nowMs / 1000) - seconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(diff / 86400);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  return formatDate(seconds);
}

/** A friendly "time left" for a number of seconds. */
export function formatEta(seconds: number): string {
  if (seconds < 10) return 'almost done';
  if (seconds < 90) return `about ${Math.round(seconds / 5) * 5} seconds left`;
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} min left`;
}