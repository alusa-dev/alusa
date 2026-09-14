import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

type OtpCodeFieldProps = {
  value: string;
  onChangeText: (_value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  error?: boolean;
};

export function OtpCodeField({ value, onChangeText, disabled = false, autoFocus = false, error = false }: OtpCodeFieldProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const digits = useMemo(() => Array.from({ length: 6 }, (_, index) => value[index] ?? ''), [value]);
  const activeIndex = Math.min(value.length, digits.length - 1);

  return (
    <View style={styles.wrapper} accessibilityRole="none">
      <View pointerEvents="none" style={styles.digits}>
        {digits.map((digit, index) => {
          const isActive = focused && index === activeIndex && !disabled;
          return (
            <View
              key={index}
              style={[
                styles.digitBox,
                digit ? styles.digitBoxFilled : null,
                isActive ? styles.digitBoxFocused : null,
                error ? styles.digitBoxError : null,
              ]}
            >
              <Text pointerEvents="none" style={styles.digitText}>{digit}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        accessibilityLabel="Código de segurança de 6 dígitos"
        value={value}
        onChangeText={(text) => onChangeText(text.replace(/\D/g, '').slice(0, 6))}
        autoFocus={autoFocus}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        keyboardType="number-pad"
        maxLength={6}
        editable={!disabled}
        caretHidden
        selectionColor="transparent"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    minHeight: 58,
  },
  digits: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  digitBox: {
    width: 46,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceNeutral,
  },
  digitBoxFilled: {
    borderColor: colors.brandSoft,
    backgroundColor: colors.surface,
  },
  digitBoxFocused: {
    borderColor: colors.brand,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  digitBoxError: {
    borderColor: colors.danger,
  },
  digitText: {
    padding: 0,
    color: colors.ink,
    fontSize: 23,
    fontWeight: '600',
    textAlign: 'center',
  },
  input: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    opacity: 0.02,
    color: 'transparent',
    backgroundColor: 'transparent',
  },
});
