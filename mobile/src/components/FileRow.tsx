import { ChevronRight, PinOff } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { FileRow } from '../db/queries';
import { iconFor } from '../fileTypes';
import { formatDate, formatRelative, formatSize } from '../format';
import { Text, useTheme, useThemedStyles, type Palette } from '../ui';

export const ROW_HEIGHT = 64;

export type RowMode = 'browse' | 'search' | 'recent' | 'pinned';

/** The second line under a file's name, depending on where the list is shown. */
export function subtitleFor(row: FileRow, mode: RowMode): { subtitle: string; headEllipsis: boolean } {
  switch (mode) {
    case 'search':
      return { subtitle: row.parent, headEllipsis: true };
    case 'recent':
      return { subtitle: `${formatRelative(row.mtime)} · ${row.parent}`, headEllipsis: false };
    case 'pinned':
      return { subtitle: row.path, headEllipsis: true };
    default:
      // Folders need no caption: the chevron says it all.
      return { subtitle: row.isDir ? '' : `${formatSize(row.size)} · ${formatDate(row.mtime)}`, headEllipsis: false };
  }
}

interface Props {
  item: FileRow;
  subtitle: string;
  headEllipsis?: boolean;
  onPress: (row: FileRow) => void;
  onLongPress?: (row: FileRow) => void;
  onUnpin?: (row: FileRow) => void;
}

export const FileListRow = memo(function FileListRow({ item, subtitle, headEllipsis, onPress, onLongPress, onUnpin }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { Icon, color } = iconFor(item.ext, item.isDir, colors);

  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      accessibilityLabel={item.name}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.iconBox, { backgroundColor: `${color}22` }]}>
        <Icon size={22} color={color} />
      </View>
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.name}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1} ellipsizeMode={headEllipsis ? 'head' : 'tail'}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onUnpin ? (
        <Pressable onPress={() => onUnpin(item)} hitSlop={12} accessibilityLabel={`Unpin ${item.name}`}>
          <PinOff size={18} color={colors.muted} />
        </Pressable>
      ) : item.isDir ? (
        <ChevronRight size={18} color={colors.muted} />
      ) : null}
    </Pressable>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    pressed: { backgroundColor: c.surfaceAlt },
    iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    text: { flex: 1 },
  });