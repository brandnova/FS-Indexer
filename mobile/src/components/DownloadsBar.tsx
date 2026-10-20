import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SESSION_START, summarize, useDownloads } from '../downloadQueue';
import { Text, radius, useTheme, useThemedStyles, type Palette } from '../ui';
import Bar from './Bar';

// Raise or lower this if the bar sits too close to (or too far above) your bottom tab bar.
const BOTTOM_OFFSET = 92;

/** The strip above the tab bar that shows downloads in progress. Tap it to see them all. */
export default function DownloadsBar({ onPress }: { onPress: () => void }) {
  const all = useDownloads();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const items = all.filter((i) => i.addedAt >= SESSION_START); // older history stays in the list only
  const s = summarize(items);
  const [hidden, setHidden] = useState(false);

  // A finished batch fades away after a few seconds, unless something failed. New activity brings it back.
  useEffect(() => {
    if (s.running || s.failed > 0) {
      setHidden(false);
      return undefined;
    }
    const timer = setTimeout(() => setHidden(true), 8000);
    return () => clearTimeout(timer);
  }, [s.running, s.failed, s.done]);

  if (items.length === 0 || hidden) return null;

  const files = (n: number) => (n === 1 ? '1 file' : `${n} files`);
  const pct = Math.round(s.fraction * 100);
  const title = s.running ? `Downloading ${files(s.active + s.queued)}` : `${files(s.done)} saved to Downloads`;
  const sub = s.running
  ? `${s.done} of ${s.total} done · ${pct}%${s.failed ? ` · ${s.failed} failed` : ''}`
  : s.failed
  ? `${s.failed} failed. Tap to try again.`
  : 'Tap to see them.';

  return (
    <View style={styles.wrap} pointerEvents="box-none">
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`}>
    <View style={styles.row}>
    {s.running ? <ActivityIndicator size="small" color={colors.primary} /> : <Check size={18} color={colors.primary} />}
    <View style={styles.texts}>
    <Text variant="bodyStrong">{title}</Text>
    <Text variant="caption" tone="muted">
    {sub}
    </Text>
    </View>
    </View>
    {s.running ? <Bar value={s.fraction} /> : null}
    </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) =>
StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, bottom: BOTTOM_OFFSET },
  card: {
    gap: 10,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  texts: { flex: 1, gap: 1 },
});
