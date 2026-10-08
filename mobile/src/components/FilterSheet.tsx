import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FILE_KINDS } from '../fileTypes';
import {
  DEFAULT_FILTERS,
  MODIFIED_OPTIONS,
  SCOPE_OPTIONS,
  SIZE_OPTIONS,
  SORT_OPTIONS,
  type FilterState,
} from '../filters';
import { Button, colors } from '../ui';

interface Props {
  visible: boolean;
  value: FilterState;
  onChange: (next: FilterState) => void;
  onClose: () => void;
}

export default function FilterSheet({ visible, value, onChange, onClose }: Props) {
  const toggleKind = (id: string) =>
    onChange({
      ...value,
      kinds: value.kinds.includes(id) ? value.kinds.filter((k) => k !== id) : [...value.kinds, id],
    });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.sheet}>
          <Text style={styles.title}>Filters and sorting</Text>

          <ScrollView contentContainerStyle={styles.content}>
            <Section title="Type">
              {FILE_KINDS.map((k) => (
                <Chip key={k.id} label={k.label} active={value.kinds.includes(k.id)} onPress={() => toggleKind(k.id)} />
              ))}
            </Section>

            <Section title="Modified">
              {MODIFIED_OPTIONS.map((o) => (
                <Chip key={o.key} label={o.label} active={value.modified === o.key} onPress={() => onChange({ ...value, modified: o.key })} />
              ))}
            </Section>

            <Section title="Size">
              {SIZE_OPTIONS.map((o) => (
                <Chip key={o.key} label={o.label} active={value.size === o.key} onPress={() => onChange({ ...value, size: o.key })} />
              ))}
            </Section>

            <Section title="Sort by">
              {SORT_OPTIONS.map((o) => (
                <Chip key={o.key} label={o.label} active={value.sort === o.key} onPress={() => onChange({ ...value, sort: o.key })} />
              ))}
            </Section>

            <Section title="Search in">
              {SCOPE_OPTIONS.map((o) => (
                <Chip key={o.key} label={o.label} active={value.scope === o.key} onPress={() => onChange({ ...value, scope: o.key })} />
              ))}
            </Section>

            <Text style={styles.note}>
              Type, date and size apply to files. Folders stay visible while you browse, and are hidden from search and
              Recent results while a filter is on.
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <View style={styles.actionItem}>
              <Button title="Reset" variant="secondary" onPress={() => onChange(DEFAULT_FILTERS)} />
            </View>
            <View style={styles.actionItem}>
              <Button title="Done" onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
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
  content: { paddingHorizontal: 20, paddingBottom: 8, gap: 18 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { color: colors.text, fontSize: 14 },
  chipLabelActive: { color: '#fff', fontWeight: '600' },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 12 },
  actionItem: { flex: 1 },
});