import { forwardRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AppText } from './AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export type TextFieldProps = TextInputProps & {
  label?: string;
  size?: 'default' | 'large';
  error?: string;
  leftIcon?: ReactNode;
  rightElement?: ReactNode;
  shellStyle?: StyleProp<ViewStyle>;
  errorStyle?: StyleProp<TextStyle>;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(
  ({ label, size = 'default', error, style, onFocus, onBlur, leftIcon, rightElement, shellStyle, errorStyle, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    return (
      <View style={styles.wrapper}>
        {label ? (
          <AppText variant="label" weight="medium" tone="muted">
            {label}
          </AppText>
        ) : null}
        <View style={[styles.inputShell, size === 'large' ? styles.inputShellLarge : null, focused ? styles.inputFocused : null, error ? styles.inputError : null, shellStyle]}>
          {leftIcon ? <View style={styles.iconSlot}>{leftIcon}</View> : null}
          <TextInput
            ref={ref}
            placeholderTextColor={colors.inkSubtle}
            autoCapitalize="none"
            style={[styles.input, size === 'large' ? styles.inputLarge : null, style]}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
            {...props}
          />
          {rightElement ? <View style={styles.iconSlot}>{rightElement}</View> : null}
        </View>
        {error ? (
          <AppText variant="small" tone="danger" style={errorStyle}>
            {error}
          </AppText>
        ) : null}
      </View>
    );
  },
);

TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  inputShell: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: '#F4F4F6',
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  input: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 0,
    color: colors.ink,
    fontSize: 16,
  },
  inputShellLarge: {
    minHeight: 72,
    borderRadius: radius.lg,
  },
  inputLarge: {
    minHeight: 44,
    fontSize: 18,
  },
  inputFocused: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  inputError: {
    backgroundColor: colors.white,
  },
  iconSlot: {
    width: 24,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
