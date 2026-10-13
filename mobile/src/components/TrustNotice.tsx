import { ShieldAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { Text, radius, useTheme, useThemedStyles, type Palette } from '../ui';

/**
 * A slim, hard-to-miss reminder that the connection to the PC isn't encrypted (yet),
 * so it should only be used on a trusted network or a direct hotspot link.
 */
export default function TrustNotice({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.box, compact && styles.compact]}>
      <ShieldAlert size={compact ? 18 : 22} color={colors.folder} />
      <View style={styles.texts}>
        <Text variant="bodyStrong">Trusted networks only</Text>
        <Text variant="caption" tone="muted">
          {compact
            ? "The link to your PC isn't encrypted. Use home Wi-Fi, or a hotspot between just your phone and PC."
            : "The link between your phone and PC isn't encrypted. Use your home network, or link just the two of them: turn on your phone's hotspot and join it from the PC."}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'flex-start',
      padding: 14,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderLeftWidth: 6,
      borderLeftColor: c.folder,
    },
    compact: { padding: 10, gap: 10 },
    texts: { flex: 1, gap: 2 },
  });