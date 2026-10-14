import { Copy, ExternalLink, Share2 } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Image, Platform, View } from 'react-native';
import type { FileRow } from '../db/queries';
import { formatDateTime, formatSize } from '../format';
import { Button, Sheet, Text, radius, useTheme } from '../ui';
import { useFileActions } from '../useFileActions';

interface Props {
  row: FileRow | null; // null = closed
  pcPath: string | null; // null = unknown (older agent, or not fetched yet)
  onCopy: (label: string, text: string) => void;
  onClose: () => void;
}

export default function DetailsSheet({ row, pcPath, onCopy, onClose }: Props) {
  const { colors } = useTheme();
  const files = useFileActions(row);
  const [failedImage, setFailedImage] = useState<string | null>(null);

  const isFile = row !== null && !row.isDir;
  const canOpen = isFile && files.access === 'ready';
  const working = files.busy !== null;

  return (
    <Sheet
      visible={row !== null}
      onClose={onClose}
      title={row?.name}
      footer={
        row ? (
          <>
            {canOpen ? (
              <>
                <Button
                  title={files.busy === 'open' ? 'Opening...' : 'Open'}
                  icon={ExternalLink}
                  loading={files.busy === 'open'}
                  disabled={working && files.busy !== 'open'}
                  onPress={files.open}
                />
                <Button
                  title="Share"
                  icon={Share2}
                  variant="secondary"
                  loading={files.busy === 'share'}
                  disabled={working && files.busy !== 'share'}
                  onPress={files.share}
                />
              </>
            ) : null}
            {pcPath ? (
              <Button
                title="Copy PC path"
                icon={Copy}
                variant={canOpen ? 'secondary' : 'primary'}
                onPress={() => onCopy('PC path', pcPath)}
              />
            ) : null}
            <Button title="Copy app path" variant="secondary" onPress={() => onCopy('App path', row.path)} />
            <Button title="Copy name" variant="secondary" onPress={() => onCopy('Name', row.name)} />
          </>
        ) : null
      }
    >
      {row ? (
        <>
          {files.image && failedImage !== row.path ? (
            <Image
              source={files.image}
              style={{ height: 200, borderRadius: radius.md, backgroundColor: colors.bg }}
              resizeMode="contain"
              accessibilityLabel={`Preview of ${row.name}`}
              onError={() => setFailedImage(row.path)}
            />
          ) : null}

          {files.text ? (
            <View
              style={{
                padding: 10,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.bg,
              }}
            >
              <Text
                selectable
                numberOfLines={12}
                style={{ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 }}
              >
                {files.text}
              </Text>
            </View>
          ) : null}

          {isFile && files.access === 'checking' ? (
            <Text tone="muted">Checking whether your PC can send this file...</Text>
          ) : null}

          {isFile && files.notice ? (
            <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft }}>
              <Text>{files.notice}</Text>
            </View>
          ) : null}

          {files.busy ? (
            <Text tone="muted" accessibilityLiveRegion="polite">
              Copying to your phone... {Math.round((files.progress ?? 0) * 100)}%
            </Text>
          ) : null}

          {files.error ? (
            <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerSoft }}>
              <Text tone="danger">{files.error}</Text>
            </View>
          ) : null}

          <Field label="On your PC">
            {pcPath ? (
              <Text selectable>{pcPath}</Text>
            ) : (
              <Text tone="muted">Not available yet. It appears once the app has connected to an up-to-date agent.</Text>
            )}
          </Field>
          <Field label="In this app">
            <Text selectable>{row.path}</Text>
          </Field>
          <Field label="Size">
            <Text>{formatSize(row.size)}</Text>
          </Field>
          <Field label="Modified">
            <Text>{formatDateTime(row.mtime)}</Text>
          </Field>
        </>
      ) : null}
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      {children}
    </View>
  );
}