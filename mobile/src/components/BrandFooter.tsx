import { Linking, Pressable } from 'react-native';
import { BRAND } from '../brand';
import { Text } from '../ui';

/** A quiet credit line with a link, for the bottom of the About card. */
export default function BrandFooter() {
  return (
    <Pressable
      onPress={() => void Linking.openURL(BRAND.url).catch(() => {})}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel={`${BRAND.line}. Opens ${BRAND.url}`}
      style={{ alignItems: 'center', gap: 2, paddingTop: 4 }}
    >
      <Text variant="label" tone="primary">
        {BRAND.line}
      </Text>
      <Text variant="caption" tone="muted">
        {BRAND.url.replace(/^https?:\/\//, '')}
      </Text>
    </Pressable>
  );
}