import { Clock, Folder, House, Pin, Settings, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, fonts, radius, useTheme, useThemedStyles, type Palette } from '../ui';

export type TabKey = 'home' | 'files' | 'recent' | 'pinned' | 'settings';

const TABS: { key: TabKey; label: string; Icon: LucideIcon }[] = [
  { key: 'home', label: 'Home', Icon: House },
  { key: 'files', label: 'Files', Icon: Folder },
  { key: 'recent', label: 'Recent', Icon: Clock },
  { key: 'pinned', label: 'Pinned', Icon: Pin },
  { key: 'settings', label: 'Settings', Icon: Settings },
];

export default function TabBar({ tab, onChange }: { tab: TabKey; onChange: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map(({ key, label, Icon }) => {
        const active = tab === key;
        return (
          <Pressable
            key={key}
            style={styles.item}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
          >
            <View style={[styles.pill, active && styles.pillActive]}>
              <Icon size={22} color={active ? colors.primary : colors.muted} />
            </View>
            <Text variant="caption" tone={active ? 'primary' : 'muted'} style={active ? styles.labelActive : undefined}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: 8,
    },
    item: { flex: 1, alignItems: 'center', gap: 2 },
    pill: { width: 56, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    pillActive: { backgroundColor: c.primarySoft },
    labelActive: { fontFamily: fonts.bold },
  });