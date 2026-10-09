import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, typography, type TextVariant } from '../theme/tokens';

export { ThemeProvider, useTheme, useThemedStyles } from '../theme/ThemeProvider';
export { fonts, radius, space } from '../theme/tokens';
export type { Palette, TextVariant } from '../theme/tokens';
export { FadeIn } from './FadeIn';
export { SkeletonRows } from './Skeleton';

// ---------- text ----------

type Tone = 'text' | 'muted' | 'primary' | 'onPrimary' | 'success' | 'danger' | 'warning';

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: Tone;
}

export function Text({ variant = 'body', tone = 'text', style, accessibilityRole, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  // Big titles are headings for screen readers unless told otherwise.
  const role = accessibilityRole ?? (variant === 'display' || variant === 'title' ? 'header' : undefined);
  return <RNText {...rest} accessibilityRole={role} style={[typography[variant], { color: colors[tone] }, style]} />;
}

// ---------- buttons ----------

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'tonal' | 'secondary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
}

export function Button({ title, onPress, variant = 'primary', size = 'md', icon: Icon, disabled, loading }: ButtonProps) {
  const { colors } = useTheme();
  const look = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    tonal: { bg: colors.primarySoft, fg: colors.primary, border: colors.primarySoft },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  const small = size === 'sm';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={small ? 4 : 0}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => ({
        minHeight: small ? 40 : 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: radius.md,
        borderWidth: 1,
        backgroundColor: look.bg,
        borderColor: look.border,
        paddingVertical: small ? 8 : 12,
        paddingHorizontal: small ? 14 : 18,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={look.fg} />
      ) : Icon ? (
        <Icon size={small ? 16 : 18} color={look.fg} strokeWidth={2.25} />
      ) : null}
      <RNText style={[typography[small ? 'label' : 'bodyStrong'], { color: look.fg }]}>{title}</RNText>
    </Pressable>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  label,
  color,
  size = 22,
  badge,
}: {
  icon: LucideIcon;
  onPress: () => void;
  label: string; // read out by screen readers
  color?: string;
  size?: number;
  badge?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, active` : label}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }}
    >
      <Icon size={size} color={color ?? colors.muted} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 9,
            right: 9,
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: colors.danger,
            borderWidth: 1.5,
            borderColor: colors.surface,
          }}
        />
      ) : null}
    </Pressable>
  );
}

// ---------- containers ----------

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        borderWidth: 1,
        backgroundColor: active ? colors.primary : colors.surface,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <RNText style={[typography.label, { color: active ? colors.onPrimary : colors.text }]}>{label}</RNText>
    </Pressable>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={{ height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct}%`, height: 8, backgroundColor: colors.primary }} />
    </View>
  );
}

export function StatusChip({ kind, label }: { kind: 'ok' | 'bad' | 'idle'; label: string }) {
  const { colors } = useTheme();
  const [bg, fg] = {
    ok: [colors.successSoft, colors.success],
    bad: [colors.dangerSoft, colors.danger],
    idle: [colors.surfaceAlt, colors.muted],
  }[kind];

  return (
    <View
      accessible
      accessibilityLabel={`Status: ${label}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: radius.pill,
        backgroundColor: bg,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fg }} />
      <RNText style={[typography.caption, { color: fg, fontFamily: fonts.semibold }]}>{label}</RNText>
    </View>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 4, gap: 4 }}>
      {options.map(({ key, label, icon: Icon }) => {
        const active = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              minHeight: 40,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: radius.sm + 2,
              backgroundColor: active ? colors.surface : 'transparent',
              borderWidth: active ? 1 : 0,
              borderColor: colors.border,
            }}
          >
            {Icon ? <Icon size={16} color={active ? colors.primary : colors.muted} /> : null}
            <RNText style={[typography.label, { color: active ? colors.primary : colors.muted }]}>{label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A tappable row with an icon, used inside sheets and settings cards. */
export function ActionRow({
  icon: Icon,
  title,
  subtitle,
  onPress,
  tone = 'normal',
  right,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  tone?: 'normal' | 'danger';
  right?: ReactNode;
}) {
  const { colors } = useTheme();
  const danger = tone === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: danger ? colors.dangerSoft : colors.primarySoft,
        }}
      >
        <Icon size={20} color={danger ? colors.danger : colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <RNText style={[typography.bodyStrong, { color: danger ? colors.danger : colors.text }]}>{title}</RNText>
        {subtitle ? <RNText style={[typography.caption, { color: colors.muted }]}>{subtitle}</RNText> : null}
      </View>
      {right ?? (onPress ? <ChevronRight size={18} color={colors.muted} /> : null)}
    </Pressable>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: LucideIcon;
  title: string;
  message?: string;
  action?: { title: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 32, paddingVertical: 40, gap: 10 }}>
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceAlt,
        }}
      >
        <Icon size={32} color={colors.muted} />
      </View>
      <RNText style={[typography.heading, { color: colors.text, textAlign: 'center' }]}>{title}</RNText>
      {message ? (
        <RNText style={[typography.body, { color: colors.muted, textAlign: 'center' }]}>{message}</RNText>
      ) : null}
      {action ? (
        <View style={{ marginTop: 6 }}>
          <Button title={action.title} variant="tonal" size="sm" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

// ---------- overlays ----------

export function Toast({ message }: { message: string | null }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 84, alignItems: 'center' }}
    >
      <View
        style={{
          backgroundColor: colors.text,
          borderRadius: radius.pill,
          paddingHorizontal: 18,
          paddingVertical: 10,
          maxWidth: '85%',
        }}
      >
        <RNText style={[typography.label, { color: colors.bg }]}>{message}</RNText>
      </View>
    </View>
  );
}

/** A panel that slides up from the bottom, for options that shouldn't take up screen space. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: '88%',
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingTop: 10,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <View
            style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 }}
          />
          {title ? (
            <RNText
              accessibilityRole="header"
              numberOfLines={2}
              style={[typography.title, { color: colors.text, paddingHorizontal: 20, marginBottom: 8 }]}
            >
              {title}
            </RNText>
          ) : null}
          {/* flexShrink lets the footer stay visible when the content is tall */}
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14 }}
            bounces={false}
          >
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 10 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}