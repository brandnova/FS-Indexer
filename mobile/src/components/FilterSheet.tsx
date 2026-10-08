import type { ReactNode } from 'react';
import { View } from 'react-native';
import { FILE_KINDS } from '../fileTypes';
import {
  DEFAULT_FILTERS,
  MODIFIED_OPTIONS,
  SCOPE_OPTIONS,
  SIZE_OPTIONS,
  SORT_OPTIONS,
  type FilterState,
} from '../filters';
import { Button, Chip, Sheet, Text } from '../ui';

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
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Sort and filter"
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Reset" variant="secondary" onPress={() => onChange(DEFAULT_FILTERS)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Done" onPress={onClose} />
          </View>
        </View>
      }
    >
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

      <Text variant="caption" tone="muted">
        Type, date and size apply to files. Folders stay visible while you browse, and are hidden from search and Recent
        results while a filter is on.
      </Text>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="label" tone="muted">
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}