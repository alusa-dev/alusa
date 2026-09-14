import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SelectField } from '@/components/forms/SelectField';
import { BottomSheet } from '@/components/overlays/BottomSheet';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';
import type { ReportPeriod } from '../types/report';

export function ReportFilterSheet({
  visible,
  period,
  options,
  onPeriodChange,
  onClear,
  onApply,
  onClose,
}: {
  visible: boolean;
  period: ReportPeriod;
  options: Array<{ value: ReportPeriod; label: string }>;
  onPeriodChange: (_value: ReportPeriod) => void;
  onClear: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const periodLabel = options.find((option) => option.value === period)?.label ?? 'Este mês';

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="58%" accessibilityLabel="Filtros do relatório">
      <View style={styles.header}>
        <AppText variant="subheading" weight="medium">Filtrar relatório</AppText>
        <Pressable accessibilityRole="button" onPress={onClear} hitSlop={8}>
          <AppText variant="small" weight="medium" style={styles.clear}>Limpar</AppText>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <SelectField
          label="Período"
          value={periodLabel}
          selectedValue={period}
          options={options}
          onValueChange={(value) => {
            if (options.some((option) => option.value === value)) onPeriodChange(value as ReportPeriod);
          }}
        />
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={onApply} style={({ pressed }) => [styles.apply, pressed ? styles.pressed : null]}>
        <AppText weight="medium" style={styles.applyText}>APLICAR FILTROS</AppText>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  clear: { color: colors.brand },
  content: { gap: spacing.md, paddingBottom: spacing.sm },
  apply: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand },
  applyText: { color: colors.white },
  pressed: { opacity: 0.78 },
});
