import { Pressable, StyleSheet, View } from 'react-native';
import type { ComponentType } from 'react';

import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

type ChoiceIcon = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

type ChoiceFieldProps = {
  selected: boolean;
  onPress: () => void;
  title: string;
  description: string;
  icon?: ChoiceIcon;
  accessibilityLabel?: string;
};

export function ChoiceField({ selected, onPress, title, description, icon: Icon, accessibilityLabel }: ChoiceFieldProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.container, selected ? styles.containerSelected : null, pressed ? styles.pressed : null]}
    >
      {Icon ? (
        <View style={[styles.icon, selected ? styles.iconSelected : null]}>
          <Icon color={selected ? colors.brand : colors.inkMuted} size={22} strokeWidth={1.8} />
        </View>
      ) : null}
      <View style={styles.copy}>
        <AppText variant="body" weight="medium">{title}</AppText>
        <AppText variant="small" tone="muted">{description}</AppText>
      </View>
      <View style={[styles.radio, selected ? styles.radioSelected : null]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 124,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  containerSelected: {
    borderColor: colors.brandSoft,
    backgroundColor: colors.surfaceSoft,
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceNeutral,
  },
  iconSelected: {
    backgroundColor: colors.brandSoft,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  radio: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.inkSubtle,
  },
  radioSelected: {
    borderColor: colors.brand,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  pressed: {
    opacity: 0.76,
  },
});
