import { forwardRef } from 'react';
import type { StyleProp, TextInput, TextStyle, ViewStyle } from 'react-native';
import { MagnifyingGlassIcon } from 'react-native-heroicons/outline';

import { TextField, type TextFieldProps } from '@/components/primitives/TextField';
import { colors, radius, spacing } from '@/theme/tokens';

type SearchFieldProps = Omit<TextFieldProps, 'label' | 'leftIcon' | 'shellStyle'> & {
  variant?: 'outlined' | 'filled';
  shellStyle?: StyleProp<ViewStyle>;
};

export const SearchField = forwardRef<TextInput, SearchFieldProps>(
  ({ variant = 'outlined', style, shellStyle, ...props }, ref) => (
    <TextField
      ref={ref}
      {...props}
      leftIcon={<MagnifyingGlassIcon color={colors.inkMuted} size={22} strokeWidth={1.8} />}
      shellStyle={[styles.shell, variant === 'filled' ? styles.filled : styles.outlined, shellStyle]}
      style={[styles.input, style]}
    />
  ),
);

SearchField.displayName = 'SearchField';

const styles = {
  shell: {
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  } satisfies ViewStyle,
  outlined: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  } satisfies ViewStyle,
  filled: {
    borderWidth: 0,
    backgroundColor: colors.surfaceNeutral,
    borderRadius: radius.md,
  } satisfies ViewStyle,
  input: {
    minHeight: 54,
    paddingVertical: 0,
    color: colors.ink,
    fontSize: 17,
  } satisfies TextStyle,
};
