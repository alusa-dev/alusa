import { useRef, useState } from 'react';
import { Picker, type PickerRef } from '@expo/ui/community/picker';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { ChevronDownIcon } from 'react-native-heroicons/outline';

import { BottomSheet } from '@/components/overlays/BottomSheet';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

type SelectOption = { value: string; label: string };

export function SelectField({ label, value, selectedValue, options, onValueChange }: { label: string; value: string; selectedValue: string; options: SelectOption[]; onValueChange: (value: string) => void }) {
  const pickerRef = useRef<PickerRef>(null);
  const [iosPickerVisible, setIosPickerVisible] = useState(false);

  function openPicker() {
    if (Platform.OS === 'ios') {
      setIosPickerVisible(true);
      return;
    }
    pickerRef.current?.focus();
  }

  return (
    <>
      <View style={styles.fieldGroup}>
        <AppText variant="label" weight="medium" tone="muted">{label}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={openPicker} style={({ pressed }) => [styles.field, pressed ? styles.pressed : null]}>
          <AppText numberOfLines={1} style={styles.value}>{value}</AppText>
          <ChevronDownIcon color={colors.inkMuted} size={21} strokeWidth={1.8} />
        </Pressable>
        <Picker ref={pickerRef} selectedValue={selectedValue} onValueChange={onValueChange} style={styles.hiddenPicker}>
          {options.map((option) => <Picker.Item key={option.value} label={option.label} value={option.value} style={styles.option} />)}
        </Picker>
      </View>
      {Platform.OS === 'ios' ? (
        <BottomSheet visible={iosPickerVisible} onClose={() => setIosPickerVisible(false)} maxHeight="44%" accessibilityLabel={`Selecionar ${label.toLowerCase()}`}>
          <AppText variant="subheading" weight="medium">{label}</AppText>
          <Picker selectedValue={selectedValue} onValueChange={onValueChange} style={styles.iosPicker}>
            {options.map((option) => <Picker.Item key={option.value} label={option.label} value={option.value} style={styles.option} />)}
          </Picker>
          <Pressable accessibilityRole="button" onPress={() => setIosPickerVisible(false)} style={({ pressed }) => [styles.doneButton, pressed ? styles.pressed : null]}>
            <AppText weight="medium" style={styles.doneButtonText}>CONCLUIR</AppText>
          </Pressable>
        </BottomSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: spacing.sm },
  field: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  value: { minWidth: 0, flex: 1 },
  hiddenPicker: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  iosPicker: { width: '100%', height: 224 },
  option: { fontSize: 20 },
  doneButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand },
  doneButtonText: { color: colors.white },
  pressed: { opacity: 0.78 },
});
