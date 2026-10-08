import { Copy } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FileRow } from '../db/queries';
import { formatDateTime, formatSize } from '../format';
import { Button, colors } from '../ui';

interface Props {
  row: FileRow | null; // null = closed
  pcPath: string | null; // null = unknown (older agent, or not fetched yet)
  onCopy: (label: string, text: string) => void;
  onClose: () => void;
}

export default function DetailsSheet({ row, pcPath, onCopy, onClose }: Props) {
  return (
    <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {row ? (
          <View style={styles.sheet}>
            <Text style={styles.title} numberOfLines={2}>
              {row.name}
            </Text>

            <ScrollView contentContainerStyle={styles.content}>
              <Field label="On your PC">
                {pcPath ? (
                  <Text style={styles.value} selectable>
                    {pcPath}
                  </Text>
                ) : (
                  <Text style={styles.muted}>Not available yet. It appears once the app has connected to an up-to-date agent.</Text>
                )}
              </Field>
              <Field label="In this app">
                <Text style={styles.value} selectable>
                  {row.path}
                </Text>
              </Field>
              <Field label="Size">
                <Text style={styles.value}>{formatSize(row.size)}</Text>
              </Field>
              <Field label="Modified">
                <Text style={styles.value}>{formatDateTime(row.mtime)}</Text>
              </Field>
            </ScrollView>

            <View style={styles.actions}>
              {pcPath ? <Button title="Copy PC path" icon={Copy} onPress={() => onCopy('PC path', pcPath)} /> : null}
              <Button title="Copy app path" variant="secondary" onPress={() => onCopy('App path', row.path)} />
              <Button title="Copy name" variant="secondary" onPress={() => onCopy('Name', row.name)} />
              <Button title="Close" variant="secondary" onPress={onClose} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, paddingHorizontal: 20, marginBottom: 8 },
  content: { paddingHorizontal: 20, paddingBottom: 8, gap: 14 },
  field: { gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  value: { fontSize: 15, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  actions: { gap: 10, paddingHorizontal: 20, paddingTop: 12 },
});