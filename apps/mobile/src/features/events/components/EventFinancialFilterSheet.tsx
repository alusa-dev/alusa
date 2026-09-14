import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SelectField } from '@/components/forms/SelectField';
import { BottomSheet } from '@/components/overlays/BottomSheet';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export type EventFinancialTypeFilter = 'ALL' | 'COST' | 'REVENUE';
export type EventFinancialStatusFilter = 'ALL' | 'EXPECTED' | 'PENDING' | 'PAID' | 'RECEIVED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

const typeOptions: Array<{ value: EventFinancialTypeFilter; label: string }> = [
  { value: 'ALL', label: 'Todos os tipos' },
  { value: 'COST', label: 'Custos' },
  { value: 'REVENUE', label: 'Receitas' },
];

const statusOptions: Array<{ value: EventFinancialStatusFilter; label: string }> = [
  { value: 'ALL', label: 'Todos os status' },
  { value: 'EXPECTED', label: 'Previsto' },
  { value: 'PENDING', label: 'Pendente' },
  { value: 'PAID', label: 'Pago' },
  { value: 'RECEIVED', label: 'Recebido' },
  { value: 'CANCELLED', label: 'Cancelado' },
  { value: 'REFUNDED', label: 'Estornado' },
  { value: 'PARTIALLY_REFUNDED', label: 'Estorno parcial' },
];

export function EventFinancialFilterSheet({
  visible,
  type,
  status,
  onTypeChange,
  onStatusChange,
  onClear,
  onApply,
  onClose,
}: {
  visible: boolean;
  type: EventFinancialTypeFilter;
  status: EventFinancialStatusFilter;
  onTypeChange: (_value: EventFinancialTypeFilter) => void;
  onStatusChange: (_value: EventFinancialStatusFilter) => void;
  onClear: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const typeLabel = typeOptions.find((option) => option.value === type)?.label ?? typeOptions[0].label;
  const statusLabel = statusOptions.find((option) => option.value === status)?.label ?? statusOptions[0].label;

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="72%" accessibilityLabel="Filtros dos lançamentos financeiros">
      <View style={styles.header}>
        <AppText variant="subheading" weight="medium">Filtrar lançamentos</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Limpar filtros" onPress={onClear} hitSlop={8}>
          <AppText variant="small" weight="medium" style={styles.clear}>Limpar</AppText>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SelectField
          label="Tipo"
          value={typeLabel}
          selectedValue={type}
          options={typeOptions}
          onValueChange={(value) => {
            if (typeOptions.some((option) => option.value === value)) onTypeChange(value as EventFinancialTypeFilter);
          }}
        />
        <SelectField
          label="Status"
          value={statusLabel}
          selectedValue={status}
          options={statusOptions}
          onValueChange={(value) => {
            if (statusOptions.some((option) => option.value === value)) onStatusChange(value as EventFinancialStatusFilter);
          }}
        />
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Aplicar filtros" onPress={onApply} style={({ pressed }) => [styles.apply, pressed ? styles.pressed : null]}>
        <AppText weight="medium" style={styles.applyText}>APLICAR FILTROS</AppText>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  clear: { color: colors.brand },
  content: { gap: spacing.lg, paddingBottom: spacing.sm },
  apply: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand },
  applyText: { color: colors.white },
  pressed: { opacity: 0.78 },
});
