import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Pressable, StyleSheet, View } from 'react-native';
import { CalendarDaysIcon } from 'react-native-heroicons/outline';

import { BottomSheet } from '@/components/overlays/BottomSheet';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

type DateFieldProps = {
  label: string;
  value: string;
  onPress: () => void;
};

export function DateField({ label, value, onPress }: DateFieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <AppText variant="label" weight="medium" tone="muted">{label}</AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Selecionar ${label.toLowerCase()}`}
        onPress={onPress}
        style={({ pressed }) => [styles.field, pressed ? styles.pressed : null]}
      >
        <AppText>{value}</AppText>
        <CalendarDaysIcon color={colors.inkMuted} size={20} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}

type DatePickerSheetProps = {
  visible: boolean;
  selectedDate: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  title?: string;
  buttonVariant?: 'primary' | 'accent';
  onDateChange: (event: DateTimePickerEvent, value?: Date) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function DatePickerSheet({
  visible,
  selectedDate,
  minimumDate,
  maximumDate,
  title = 'Selecionar data',
  buttonVariant = 'primary',
  onDateChange,
  onClose,
  onConfirm,
}: DatePickerSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="54%" accessibilityLabel={title}>
      <AppText variant="subheading" weight="medium">{title}</AppText>
      <DateTimePicker
        value={selectedDate}
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        mode="date"
        display="spinner"
        onChange={onDateChange}
        locale="pt-BR"
      />
      <Button title="Usar esta data" variant={buttonVariant} onPress={onConfirm} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: spacing.sm },
  field: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceNeutral,
  },
  pressed: { opacity: 0.76 },
});
