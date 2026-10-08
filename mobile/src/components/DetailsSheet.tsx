import { Copy } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { FileRow } from '../db/queries';
import { formatDateTime, formatSize } from '../format';
import { Button, Sheet, Text } from '../ui';

interface Props {
  row: FileRow | null; // null = closed
  pcPath: string | null; // null = unknown (older agent, or not fetched yet)
  onCopy: (label: string, text: string) => void;
  onClose: () => void;
}

export default function DetailsSheet({ row, pcPath, onCopy, onClose }: Props) {
  return (
    <Sheet
      visible={row !== null}
      onClose={onClose}
      title={row?.name}
      footer={
        row ? (
          <>
            {pcPath ? <Button title="Copy PC path" icon={Copy} onPress={() => onCopy('PC path', pcPath)} /> : null}
            <Button title="Copy app path" variant="secondary" onPress={() => onCopy('App path', row.path)} />
            <Button title="Copy name" variant="secondary" onPress={() => onCopy('Name', row.name)} />
          </>
        ) : null
      }
    >
      {row ? (
        <>
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