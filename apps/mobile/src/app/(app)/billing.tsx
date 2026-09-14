import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeftIcon, ChevronRightIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Screen } from '@/components/layout/Screen';
import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { AppText } from '@/components/primitives/AppText';
import { BillingFilterSheet, type BillingCategoryFilter } from '@/features/billing/components/BillingFilterSheet';
import { BillingCreateFab } from '@/features/billing/components/BillingCreateFab';
import { billingService, type BillingChargesSort } from '@/features/billing/services/billing-service';
import type { BillingCharge, BillingCategory, BillingPeriod, BillingSummary } from '@/features/billing/types/billing';
import { formatDate } from '@/features/billing/utils/formatters';
import { colors, radius, spacing } from '@/theme/tokens';
import { useAppRefresh } from '@/hooks/use-app-refresh';

const rows = [
  { key: 'received', title: 'Recebidas', color: colors.success },
  { key: 'confirmed', title: 'Confirmadas', color: colors.info },
  { key: 'awaitingPayment', title: 'Aguardando pagamento', color: colors.warning },
  { key: 'overdue', title: 'Vencidas', color: colors.danger },
] as const;

function categoryForSummaryRow(key: (typeof rows)[number]['key']): BillingCategory {
  if (key === 'received') return 'RECEIVED';
  if (key === 'confirmed') return 'CONFIRMED';
  if (key === 'awaitingPayment') return 'AWAITING_PAYMENT';
  return 'OVERDUE';
}

export default function BillingScreen() {
  const [period, setPeriod] = useState<BillingPeriod>('this-month');
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [charges, setCharges] = useState<BillingCharge[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<BillingCategoryFilter>();
  const [sort, setSort] = useState<BillingChargesSort>('created-at-desc');
  const [filterVisible, setFilterVisible] = useState(false);
  const [draftCategory, setDraftCategory] = useState<BillingCategoryFilter>();
  const [draftSort, setDraftSort] = useState<BillingChargesSort>('created-at-desc');
  const [chargesLoading, setChargesLoading] = useState(true);
  const [chargesOffset, setChargesOffset] = useState(0);
  const [chargesHasMore, setChargesHasMore] = useState(false);
  const [chargesLoadingMore, setChargesLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const loadSummary = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const response = await billingService.getSummary(period);
      setSummary(response.summary);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o resumo das cobranças.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadCharges = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setChargesLoading(true);
    try {
      const response = await billingService.listCharges({ period, category, sort, search, offset: 0, limit: 20 });
      setCharges(response.charges);
      setChargesOffset(response.offset + response.charges.length);
      setChargesHasMore(response.hasMore);
    } catch {
      setCharges([]);
      setChargesOffset(0);
      setChargesHasMore(false);
    } finally {
      if (!options.silent) setChargesLoading(false);
    }
  }, [category, period, search, sort]);

  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  useEffect(() => {
    setChargesOffset(0);
  }, [category, period, search, sort]);

  const { refreshing, refresh } = useAppRefresh(
    async () => {
      await Promise.all([loadSummary({ silent: true }), loadCharges({ silent: true })]);
    },
  );

  const openFilters = useCallback(() => {
    setDraftCategory(category);
    setDraftSort(sort);
    setFilterVisible(true);
  }, [category, sort]);

  const applyFilters = useCallback(() => {
    setCategory(draftCategory);
    setSort(draftSort);
    setFilterVisible(false);
  }, [draftCategory, draftSort]);

  const clearFilters = useCallback(() => {
    setDraftCategory(undefined);
    setDraftSort('created-at-desc');
  }, []);

  const openCategory = useCallback((selectedCategory: BillingCategory) => {
    router.push({ pathname: '/(app)/billing-charges', params: { period, category: selectedCategory } });
  }, [period]);

  const loadMoreCharges = useCallback(async () => {
    if (chargesLoading || chargesLoadingMore || loadingMoreRef.current || !chargesHasMore) return;
    loadingMoreRef.current = true;
    setChargesLoadingMore(true);
    try {
      const response = await billingService.listCharges({ period, category, sort, search, offset: chargesOffset, limit: 10 });
      setCharges((current) => {
        const existingIds = new Set(current.map((charge) => `${charge.origin}:${charge.id}`));
        return [...current, ...response.charges.filter((charge) => !existingIds.has(`${charge.origin}:${charge.id}`))];
      });
      setChargesOffset((current) => Math.max(current, response.offset + response.charges.length));
      setChargesHasMore(response.hasMore);
    } finally {
      loadingMoreRef.current = false;
      setChargesLoadingMore(false);
    }
  }, [category, chargesHasMore, chargesLoading, chargesLoadingMore, chargesOffset, period, search, sort]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 240) void loadMoreCharges();
  }, [loadMoreCharges]);

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen} onScroll={handleScroll} scrollEventThrottle={200} refreshing={refreshing} onRefresh={() => void refresh()} overlay={<BillingCreateFab />}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium">Cobranças</AppText>
      </View>

      {loading ? <BillingSummarySkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadSummary()} /> : null}
      {!loading && !error && summary ? (
        <View style={styles.summaryCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Abrir lista de cobranças"
            onPress={() => router.push({ pathname: '/(app)/billing-charges', params: { period } })}
            style={({ pressed }) => [styles.summaryHeader, pressed ? styles.pressed : null]}
          >
            <AppText weight="regular" style={styles.summaryTitle}>Resumo das cobranças</AppText>
          </Pressable>

          <View style={styles.periodSwitch} accessibilityRole="tablist">
            <PeriodOption label="Este mês" active={period === 'this-month'} onPress={() => setPeriod('this-month')} />
            <PeriodOption label="Últimos 30 dias" active={period === 'last-30-days'} onPress={() => setPeriod('last-30-days')} />
          </View>

          <View style={styles.metrics}>
            {rows.map((row) => {
              const metric = summary[row.key];
              return (
                <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={`Abrir cobranças ${row.title.toLocaleLowerCase()}`} onPress={() => openCategory(categoryForSummaryRow(row.key))} style={styles.metricRow}>
                  <AppText variant="body" weight="regular">{row.title}</AppText>
                  <View style={styles.metricValues}>
                    <View style={styles.metricColumn}>
                      <AppText variant="small" tone="muted">Cobranças</AppText>
                      <AppText variant="body" weight="regular" style={{ color: row.color }}>{metric.count}</AppText>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.metricColumn}>
                      <AppText variant="small" tone="muted">Valor (R$)</AppText>
                      <AppText variant="body" weight="regular" style={{ color: row.color }}>{formatCurrency(metric.amount)}</AppText>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {!loading && !error ? <BillingList charges={charges} loading={chargesLoading} loadingMore={chargesLoadingMore} hasMore={chargesHasMore} search={search} onSearchChange={setSearch} onOpenFilters={openFilters} hasActiveFilters={Boolean(category) || sort !== 'created-at-desc'} /> : null}
      <BillingFilterSheet
        visible={filterVisible}
        category={draftCategory}
        sort={draftSort}
        onCategoryChange={setDraftCategory}
        onSortChange={setDraftSort}
        onClear={clearFilters}
        onApply={applyFilters}
        onClose={() => setFilterVisible(false)}
      />
    </Screen>
  );
}

function PeriodOption({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.periodOption, active ? styles.periodOptionActive : null, pressed ? styles.pressed : null]}
    >
      <AppText weight="regular" style={{ color: active ? colors.brand : colors.ink }}>{label}</AppText>
    </Pressable>
  );
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryTitle: { fontSize: 20, lineHeight: 24 },
  periodSwitch: { minHeight: 54, flexDirection: 'row', alignItems: 'center', padding: 3, borderWidth: 2, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral },
  periodOption: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  periodOptionActive: { backgroundColor: colors.brandSoft },
  metrics: { gap: spacing.lg },
  metricRow: { gap: spacing.sm },
  metricValues: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.lg },
  metricColumn: { flex: 1, gap: spacing.xs },
  divider: { width: 1, backgroundColor: colors.border },
  pressed: { opacity: 0.76 },
});

function BillingList({ charges, loading, loadingMore, hasMore, search, onSearchChange, onOpenFilters, hasActiveFilters }: { charges: BillingCharge[]; loading: boolean; loadingMore: boolean; hasMore: boolean; search: string; onSearchChange: (value: string) => void; onOpenFilters: () => void; hasActiveFilters: boolean }) {
  return (
    <View style={listStyles.section}>
      <InlineSearchHeader
        title="Todas as cobranças"
        showBack={false}
        search={search}
        onSearchChange={onSearchChange}
        placeholder="Pesquisar cobrança"
        accessibilityLabel="Pesquisar todas as cobranças"
        onFilterPress={onOpenFilters}
        filterActive={hasActiveFilters}
      />
      {loading ? <BillingListSkeleton /> : null}
      {!loading && charges.length === 0 ? <EmptyState title="Nenhuma cobrança encontrada" message="As cobranças da conta aparecerão aqui quando forem geradas." /> : null}
      {!loading ? charges.map((charge) => <Pressable key={`${charge.origin}:${charge.id}`} accessibilityRole="button" accessibilityLabel={`${charge.studentName}, ${charge.description}`} onPress={() => router.push({ pathname: '/(app)/billing/[chargeId]', params: { chargeId: charge.id } })} style={({ pressed }) => [listStyles.card, pressed ? listStyles.pressed : null]}>
        <View style={listStyles.copy}>
          <AppText weight="medium" numberOfLines={1}>{charge.studentName}</AppText>
          <AppText variant="small" tone="muted" numberOfLines={1}>{charge.description}</AppText>
          <AppText variant="small" tone="muted">{charge.dueDate ? `Vencimento ${formatDate(charge.dueDate)}` : 'Sem vencimento'}</AppText>
        </View>
        <View style={listStyles.amount}>
          <AppText variant="small" weight="medium" style={{ color: colorForCategory(charge.category) }}>{charge.originalStatus}</AppText>
          <AppText weight="medium">{formatCurrency(charge.amount)}</AppText>
        </View>
        <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} style={listStyles.cardArrow} />
      </Pressable>) : null}
      {!loading && loadingMore ? <AppText variant="small" tone="muted" style={listStyles.loadingMore}>Carregando mais cobranças...</AppText> : null}
      {!loading && !loadingMore && !hasMore && charges.length > 0 ? <AppText variant="small" tone="muted" style={listStyles.endMessage}>Fim da lista</AppText> : null}
    </View>
  );
}

function BillingSummarySkeleton() {
  return (
    <View style={skeletonStyles.summaryCard} accessibilityLabel="Carregando resumo das cobranças">
      <Skeleton width="62%" height={24} />
      <View style={skeletonStyles.switchRow}><Skeleton width="48%" height={42} radius={radius.pill} /><Skeleton width="48%" height={42} radius={radius.pill} /></View>
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={skeletonStyles.metricRow}>
          <Skeleton width="38%" height={18} />
          <View style={skeletonStyles.metricValues}><Skeleton width="24%" height={16} /><Skeleton width="30%" height={16} /></View>
        </View>
      ))}
    </View>
  );
}

function BillingListSkeleton() {
  return (
    <View style={skeletonStyles.list} accessibilityLabel="Carregando cobranças">
      {[0, 1, 2].map((item) => (
        <View key={item} style={skeletonStyles.chargeCard}>
          <View style={skeletonStyles.chargeCopy}><Skeleton width="74%" height={18} /><Skeleton width="48%" height={14} /><Skeleton width="58%" height={14} /></View>
          <View style={skeletonStyles.chargeAmount}><Skeleton width={72} height={14} /><Skeleton width={64} height={16} /></View>
        </View>
      ))}
    </View>
  );
}

function colorForCategory(category: BillingCategory) {
  if (category === 'RECEIVED') return colors.success;
  if (category === 'CONFIRMED') return colors.info;
  if (category === 'AWAITING_PAYMENT') return colors.warning;
  if (category === 'CANCELLED') return colors.inkMuted;
  return colors.danger;
}

const listStyles = StyleSheet.create({
  section: { gap: spacing.md },
  card: { position: 'relative', minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, paddingRight: spacing['3xl'], borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  copy: { minWidth: 0, flex: 1, justifyContent: 'center', gap: spacing.xs },
  amount: { minWidth: 96, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'flex-end', gap: spacing.xs, paddingTop: spacing.xl, paddingBottom: spacing.xs },
  cardArrow: { position: 'absolute', top: spacing.md, right: spacing.lg },
  loadingMore: { textAlign: 'center', paddingVertical: spacing.sm },
  endMessage: { textAlign: 'center', paddingVertical: spacing.sm },
  pressed: { opacity: 0.78 },
});

const skeletonStyles = StyleSheet.create({
  summaryCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  metricRow: { gap: spacing.sm },
  metricValues: { flexDirection: 'row', justifyContent: 'space-between' },
  list: { gap: spacing.sm },
  chargeCard: { minHeight: 104, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, paddingRight: spacing['3xl'], borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  chargeCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  chargeAmount: { alignItems: 'flex-end', gap: spacing.xs },
});
