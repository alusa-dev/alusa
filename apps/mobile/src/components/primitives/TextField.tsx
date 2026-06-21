import { forwardRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from './AppText';
import { colors, radius, spacing } from '@/theme/tokens';

type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
  leftIcon?: ReactNode;
  rightElement?: ReactNode;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(
  ({ label, error, style, onFocus, onBlur, leftIcon, rightElement, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    return (
      <View style={styles.wrapper}>
        {label ? (
          <AppText variant="label" weight="medium" tone="muted">
            {label}
          </AppText>
        ) : null}
        <View style={[styles.inputShell, focused ? styles.inputFocused : null, error ? styles.inputError : null]}>
          {leftIcon ? <View style={styles.iconSlot}>{leftIcon}</View> : null}
          <TextInput
            ref={ref}
            placeholderTextColor={colors.inkSubtle}
            autoCapitalize="none"
            style={[styles.input, style]}
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
          <AppText variant="small" tone="danger">
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
  inputFocused: {
    backgroundColor: '#EFEAF5',
  },
  inputError: {
    backgroundColor: colors.dangerSoft,
  },
  iconSlot: {
    width: 24,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
