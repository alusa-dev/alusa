import { Text, type TextProps, StyleSheet } from 'react-native';

import { colors, typography } from '@/theme/tokens';
import { fontFamily } from '@/theme/typography';

type AppTextProps = TextProps & {
  variant?: 'display' | 'heading' | 'subheading' | 'body' | 'small' | 'label' | 'tiny';
  tone?: 'primary' | 'muted' | 'subtle' | 'inverse' | 'danger' | 'accent';
  weight?: 'regular' | 'medium' | 'bold';
};

export function AppText({
  variant = 'body',
  tone = 'primary',
  weight = 'regular',
  style,
  ...props
}: AppTextProps) {
  return <Text {...props} style={[styles.base, styles[variant], toneStyles[tone], weightStyles[weight], style]} />;
}

const styles = StyleSheet.create({
  base: {
    color: colors.ink,
  },
  display: {
    fontSize: typography.title,
    lineHeight: 38,
    letterSpacing: 0,
  },
  heading: {
    fontSize: typography.heading,
    lineHeight: 30,
  },
  subheading: {
    fontSize: typography.subheading,
    lineHeight: 24,
  },
  body: {
    fontSize: typography.body,
    lineHeight: 22,
  },
  small: {
    fontSize: typography.small,
    lineHeight: 18,
  },
  label: {
    fontSize: typography.small,
    lineHeight: 16,
  },
  tiny: {
    fontSize: typography.tiny,
    lineHeight: 14,
  },
});

const toneStyles = StyleSheet.create({
  primary: { color: colors.ink },
  muted: { color: colors.inkMuted },
  subtle: { color: colors.inkSubtle },
  inverse: { color: colors.white },
  danger: { color: colors.danger },
  accent: { color: colors.accent },
});

const weightStyles = StyleSheet.create({
  regular: { fontFamily: fontFamily?.regular, fontWeight: '400' },
  medium: { fontFamily: fontFamily?.medium, fontWeight: '600' },
  bold: { fontFamily: fontFamily?.bold, fontWeight: '800' },
});
