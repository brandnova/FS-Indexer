import { View } from 'react-native';
import { useTheme } from '../ui';

/** A thin progress bar. */
export default function Bar({ value, indeterminate }: { value: number; indeterminate?: boolean }) {
  const { colors } = useTheme();
  const pct = indeterminate ? 100 : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}
    >
      <View
        style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: colors.primary, opacity: indeterminate ? 0.5 : 1 }}
      />
    </View>
  );
}