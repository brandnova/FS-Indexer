import { Upload } from 'lucide-react-native';
import { View } from 'react-native';
import { formatSize } from '../format';
import { Button, Sheet, Text, radius, useTheme } from '../ui';
import { useUpload, type UploadItem } from '../useUpload';

export default function UploadSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const up = useUpload(visible);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Send files to your PC"
      footer={
        up.access === 'ready' ? (
          <>
            <Button
              title={up.running ? 'Sending...' : 'Choose files'}
              icon={Upload}
              loading={up.running}
              onPress={up.choose}
            />
            {up.running ? (
              <Button title="Cancel" variant="secondary" onPress={up.cancel} />
            ) : (
              <Button title="Done" variant="secondary" onPress={onClose} />
            )}
          </>
        ) : (
          <Button title="Close" variant="secondary" onPress={onClose} />
        )
      }
    >
      {up.access === 'checking' ? <Text tone="muted">Checking whether your PC can receive files...</Text> : null}

      {up.notice ? (
        <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft }}>
          <Text>{up.notice}</Text>
        </View>
      ) : null}

      {up.access === 'ready' && up.items.length === 0 ? (
        <Text tone="muted">
          Choose photos, documents or anything else. They go into the upload folder on your PC
          {up.maxMb ? `, up to ${up.maxMb} MB each` : ''}. Nothing there is ever overwritten.
        </Text>
      ) : null}

      {up.error ? (
        <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerSoft }}>
          <Text tone="danger">{up.error}</Text>
        </View>
      ) : null}

      {up.items.map((item) => (
        <Row key={item.id} item={item} />
      ))}
    </Sheet>
  );
}

function Row({ item }: { item: UploadItem }) {
  const detail =
    item.status === 'waiting'
      ? 'Waiting'
      : item.status === 'sending'
        ? `Sending... ${Math.round(item.progress * 100)}%`
        : item.status === 'done'
          ? item.savedAs && item.savedAs !== item.name
            ? `Saved on your PC as ${item.savedAs}`
            : 'Saved on your PC'
          : item.message ?? 'Failed';

  return (
    <View style={{ gap: 2 }} accessibilityLiveRegion="polite">
      <Text variant="bodyStrong" numberOfLines={1}>
        {item.name}
        {item.size !== null ? `  ·  ${formatSize(item.size)}` : ''}
      </Text>
      <Text variant="caption" tone={item.status === 'failed' ? 'danger' : 'muted'}>
        {detail}
      </Text>
    </View>
  );
}