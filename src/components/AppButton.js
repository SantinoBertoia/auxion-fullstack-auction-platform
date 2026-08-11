import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, typography } from '../constants/theme';

export default function AppButton({ title, onPress, variant = 'primary', disabled = false, style }) {
  const isSecondary = variant === 'secondary';
  const isLink = variant === 'link';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isSecondary && styles.secondary,
        isLink && styles.link,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Text style={[styles.text, isSecondary && styles.secondaryText, isLink && styles.linkText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondary: {
    backgroundColor: colors.white,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  link: {
    backgroundColor: 'transparent',
    minHeight: 34,
    paddingVertical: spacing.xs,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.85,
  },
  text: {
    color: colors.white,
    fontSize: typography.body,
    fontWeight: '700',
  },
  secondaryText: {
    color: colors.primary,
  },
  linkText: {
    color: colors.primary,
  },
});
