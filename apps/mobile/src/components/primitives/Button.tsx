import { ActivityIndicator, Pressable, StyleSheet, type PressableProps, View } from 'react-native';

import { AppText } from './AppText';
import { colors, radius, spacing } from '@/theme/tokens';

type ButtonProps = PressableProps & {
  title: string;
  variant?: 'primary' | 'accent' | 'ghost';
  loading?: boolean;
};

export function Button({ title, variant = 'primary', loading = false, disabled, style, ...props }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        variantStyles[variant],
        state.pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={variant === 'accent' ? colors.brand : colors.white} /> : null}
        <AppText tone={variant === 'accent' ? 'primary' : 'inverse'} weight="bold" style={styles.text}>
          {title}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: {
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.94,
  },
  disabled: {
    opacity: 0.5,
  },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.brand },
  accent: { backgroundColor: colors.accent },
  ghost: { backgroundColor: 'rgba(62, 31, 99, 0.12)' },
});
