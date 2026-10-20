import { FolderOpen } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import {
  cancelAllDownloads,
  cancelDownload,
  clearFinishedDownloads,
  removeDownload,
  retryDownload,
  summarize,
  useDownloads,
  type DownloadItem,
} from '../downloadQueue';
import { openDownloadsFolder } from '../downloads';
import { formatSize } from '../format';
import { Button, Sheet, Text } from '../ui';
import Bar from './Bar';

function formatEta(seconds: number): string {
  if (seconds < 5) return 'almost done';
  if (seconds < 60) return `${Math.round(seconds)} s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

function ago(ms: number | null): string {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function detail(item: DownloadItem): string {
  switch (item.status) {
    case 'queued':
      return `Waiting · ${formatSize(item.row.size)}`;
    case 'downloading': {
      const speed = item.bytesPerSecond ? ` · ${formatSize(item.bytesPerSecond)}/s` : '';
      const eta = item.etaSeconds !== null ? ` · ${formatEta(item.etaSeconds)}` : '';
      return `${Math.round(item.progress * 100)}% of ${formatSize(item.row.size)}${speed}${eta}`;
    }
    case 'saving':
      return 'Saving to Downloads...';
    case 'done':
      return `Saved to ${item.where}${item.savedAs && item.savedAs !== item.row.name ? ` as ${item.savedAs}` : ''} · ${ago(item.finishedAt)}`;
    case 'failed':
      return `${item.error ?? 'Failed'} · ${ago(item.finishedAt)}`;
    case 'cancelled':
      return 'Cancelled';
  }
}

const rank: Record<DownloadItem['status'], number> = { downloading: 0, saving: 0, queued: 1, failed: 2, done: 3, cancelled: 3 };

export default function DownloadsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const items = useDownloads();
  const s = summarize(items);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...items].sort((a, b) => rank[a.status] - rank[b.status] || (b.finishedAt ?? b.addedAt) - (a.finishedAt ?? a.addedAt));
  const hasFinished = items.some((i) => i.status === 'done' || i.status === 'cancelled');

  return (
    <Sheet
    visible={visible}
    onClose={onClose}
    title="Downloads"
    footer={
      <>
      {s.running ? <Button title="Cancel all" variant="secondary" onPress={cancelAllDownloads} /> : null}
      {hasFinished ? <Button title="Clear finished" variant="secondary" onPress={clearFinishedDownloads} /> : null}
      <Button
      title={Platform.OS === 'android' ? 'Open Downloads' : 'Open Files'}
      icon={FolderOpen}
      variant="secondary"
      onPress={() => {
        setError(null);
        void openDownloadsFolder().catch(() => setError("Couldn't open it. Look in the Downloads app, or your Files app."));
      }}
      />
      </>
    }
    >
    {items.length === 0 ? (
      <Text tone="muted">Nothing here yet. Open a file and tap Download: you can add as many as you like.</Text>
    ) : null}

    {s.running ? (
      <View style={{ gap: 6 }}>
      <Text variant="bodyStrong">
      {s.done} of {s.total} done · {Math.round(s.fraction * 100)}%
      </Text>
      <Bar value={s.fraction} />
      </View>
    ) : null}

    {error ? <Text tone="danger">{error}</Text> : null}

    {sorted.map((item) => (
      <Row key={item.id} item={item} />
    ))}

    {items.some((i) => i.status === 'done' || i.status === 'failed') ? (
      <Text variant="caption" tone="muted">
      Finished downloads are remembered for 30 days.
      </Text>
    ) : null}
    </Sheet>
  );
}

function Row({ item }: { item: DownloadItem }) {
  const waiting = item.status === 'queued' || item.status === 'downloading';
  const finished = item.status === 'done' || item.status === 'failed' || item.status === 'cancelled';

  return (
    <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
    <Text variant="bodyStrong" numberOfLines={1}>
    {item.row.name}
    </Text>
    <Text variant="caption" tone={item.status === 'failed' ? 'danger' : 'muted'}>
    {detail(item)}
    </Text>
    {item.status === 'downloading' || item.status === 'saving' ? (
      <Bar value={item.progress} indeterminate={item.status === 'saving'} />
    ) : null}
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
    {waiting ? <Button title="Cancel" variant="ghost" size="sm" onPress={() => cancelDownload(item.id)} /> : null}
    {item.status === 'failed' || item.status === 'cancelled' ? (
      <Button title="Try again" variant="tonal" size="sm" onPress={() => retryDownload(item.id)} />
    ) : null}
    {finished ? <Button title="Remove" variant="ghost" size="sm" onPress={() => removeDownload(item.id)} /> : null}
    </View>
    </View>
  );
}
