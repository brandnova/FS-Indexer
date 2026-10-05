import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

export const colors = {
  bg: '#f8fafc',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  primary: '#4f46e5',
  danger: '#dc2626',
  ok: '#16a34a',
};

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  icon?: LucideIcon;
}

export function Button({ title, onPress, variant = 'primary', disabled, icon: Icon }: ButtonProps) {
  const iconColor = variant === 'secondary' ? colors.text : '#fff';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        (pressed || disabled) && styles.dim,
      ]}
    >
      {Icon ? <Icon size={18} color={iconColor} strokeWidth={2.25} /> : null}
      <Text style={[styles.label, variant === 'secondary' && styles.labelSecondary]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  dim: { opacity: 0.6 },
  label: { color: '#fff', fontSize: 16, fontWeight: '600' },
  labelSecondary: { color: colors.text },
});