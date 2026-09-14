import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SelectField } from '@/components/forms/SelectField';
import { BottomSheet } from '@/components/overlays/BottomSheet';
import { AppText } from '@/components/primitives/AppText';
import type { StatementDirection, StatementPeriod } from '../types/statement';
import { colors, radius, spacing } from '@/theme/tokens';

export function StatementFilterSheet({
  visible,
  period,
  direction,
  onPeriodChange,
  onDirectionChange,
  onClear,
  onApply,
  onClose,
}: {
  visible: boolean;
  period: StatementPeriod;
  direction: StatementDirection;
  onPeriodChange: (value: StatementPeriod) => void;
  onDirectionChange: (value: StatementDirection) => void;
  onClear: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const periodLabel = period === 'this-month' ? 'Este mês' : 'Últimos 30 dias';
  const directionLabel = direction === 'desc' ? 'Mais recentes' : 'Mais antigas';

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="78%" accessibilityLabel="Filtros do extrato">
      <View style={styles.header}>
        <AppText variant="subheading" weight="medium">Filtrar extrato</AppText>
        <Pressable accessibilityRole="button" onPress={onClear}>
          <AppText variant="small" weight="medium" style={styles.clear}>Limpar</AppText>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <SelectField label="Período" value={periodLabel} selectedValue={period} options={[{ value: 'this-month', label: 'Este mês' }, { value: 'last-30-days', label: 'Últimos 30 dias' }]} onValueChange={(value) => { if (value === 'this-month' || value === 'last-30-days') onPeriodChange(value); }} />
        <SelectField label="Ordenar por" value={directionLabel} selectedValue={direction} options={[{ value: 'desc', label: 'Mais recentes' }, { value: 'asc', label: 'Mais antigas' }]} onValueChange={(value) => { if (value === 'desc' || value === 'asc') onDirectionChange(value); }} />
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
