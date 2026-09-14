import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { BottomSheet } from '@/components/overlays/BottomSheet';
import { SelectField } from '@/components/forms/SelectField';
import { AppText } from '@/components/primitives/AppText';
import type { BillingChargesSort } from '@/features/billing/services/billing-service';
import type { BillingCategory } from '@/features/billing/types/billing';
import { colors, radius, spacing } from '@/theme/tokens';

export type BillingCategoryFilter = BillingCategory | undefined;

const categoryFilters: Array<{ key: BillingCategoryFilter; label: string }> = [
  { label: 'Todas', key: undefined },
  { label: 'Vencidas', key: 'OVERDUE' },
  { label: 'Aguardando pagamento', key: 'AWAITING_PAYMENT' },
  { label: 'Recebidas', key: 'RECEIVED' },
  { label: 'Confirmadas', key: 'CONFIRMED' },
  { label: 'Estornadas', key: 'REFUNDED' },
  { label: 'Canceladas', key: 'CANCELLED' },
];

const sortOptions: Array<{ key: BillingChargesSort; label: string }> = [
  { key: 'created-at-desc', label: 'Mais recentes' },
  { key: 'created-at-asc', label: 'Mais antigas' },
  { key: 'priority', label: 'Prioridade financeira' },
  { key: 'due-date-asc', label: 'Vencimento mais próximo' },
  { key: 'due-date-desc', label: 'Vencimento mais distante' },
  { key: 'amount-desc', label: 'Maior valor' },
  { key: 'amount-asc', label: 'Menor valor' },
];

export function BillingFilterSheet({
  visible,
  category,
  sort,
  onCategoryChange,
  onSortChange,
  onClear,
  onApply,
  onClose,
}: {
  visible: boolean;
  category: BillingCategoryFilter;
  sort: BillingChargesSort;
  onCategoryChange: (value: BillingCategoryFilter) => void;
  onSortChange: (value: BillingChargesSort) => void;
  onClear: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const categoryLabel = categoryFilters.find((option) => option.key === category)?.label ?? 'Todas';
  const sortLabel = sortOptions.find((option) => option.key === sort)?.label ?? 'Mais recentes';

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="86%" accessibilityLabel="Filtros das cobranças">
      <View style={styles.sheetHeader}>
        <AppText variant="subheading" weight="medium">Filtrar cobranças</AppText>
        <Pressable accessibilityRole="button" onPress={onClear}><AppText variant="small" weight="medium" style={{ color: colors.brand }}>Limpar</AppText></Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
        <SelectField label="Status" value={categoryLabel} selectedValue={category ?? 'all'} options={categoryFilters.map((option) => ({ value: option.key ?? 'all', label: option.label }))} onValueChange={(value) => onCategoryChange(categoryFilters.find((option) => (option.key ?? 'all') === value)?.key)} />
        <SelectField label="Ordenar por" value={sortLabel} selectedValue={sort} options={sortOptions.map((option) => ({ value: option.key, label: option.label }))} onValueChange={(value) => { const selectedSort = sortOptions.find((option) => option.key === value)?.key; if (selectedSort) onSortChange(selectedSort); }} />
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={onApply} style={({ pressed }) => [styles.applyButton, pressed ? styles.pressed : null]}>
        <AppText weight="medium" style={styles.applyButtonText}>APLICAR FILTROS</AppText>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  sheetContent: { gap: spacing.md, paddingBottom: spacing.sm },
  applyButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand },
  applyButtonText: { color: colors.white },
  pressed: { opacity: 0.78 },
});
