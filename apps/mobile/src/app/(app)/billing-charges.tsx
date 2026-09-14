import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Screen } from '@/components/layout/Screen';
import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { AppText } from '@/components/primitives/AppText';
import { useAppRefresh } from '@/hooks/use-app-refresh';
import { BillingFilterSheet, type BillingCategoryFilter } from '@/features/billing/components/BillingFilterSheet';
import { BillingCreateFab } from '@/features/billing/components/BillingCreateFab';
import { billingService, type BillingChargesSort } from '@/features/billing/services/billing-service';
import type { BillingCategory, BillingCharge, BillingOrigin, BillingPeriod } from '@/features/billing/types/billing';
import { formatDate } from '@/features/billing/utils/formatters';
import { colors, radius, spacing } from '@/theme/tokens';

const billingCategories: BillingCategory[] = ['RECEIVED', 'CONFIRMED', 'AWAITING_PAYMENT', 'OVERDUE', 'REFUNDED', 'CANCELLED'];

function categoryFromParam(value: string | undefined): BillingCategoryFilter {
  return value && billingCategories.includes(value as BillingCategory) ? value as BillingCategory : undefined;
}

function titleForCategory(category: BillingCategoryFilter) {
  switch (category) {
    case 'RECEIVED': return 'Cobranças recebidas';
    case 'CONFIRMED': return 'Cobranças confirmadas';
    case 'AWAITING_PAYMENT': return 'Cobranças pendentes';
    case 'OVERDUE': return 'Cobranças vencidas';
    case 'REFUNDED': return 'Cobranças estornadas';
    case 'CANCELLED': return 'Cobranças canceladas';
    default: return 'Cobranças';
  }
}

export default function BillingChargesScreen({ origin }: { origin?: BillingOrigin } = {}) {
  const params = useLocalSearchParams<{ period?: string; category?: string }>();
  const initialPeriod: BillingPeriod = params.period === 'last-30-days' ? 'last-30-days' : 'this-month';
  const routeCategory = categoryFromParam(params.category);
  const [period, setPeriod] = useState<BillingPeriod>(initialPeriod);
  const [category, setCategory] = useState<BillingCategoryFilter>(routeCategory);
  const [sort, setSort] = useState<BillingChargesSort>('created-at-desc');
  const [search, setSearch] = useState('');
  const [charges, setCharges] = useState<BillingCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [draftCategory, setDraftCategory] = useState<BillingCategoryFilter>();
  const [draftSort, setDraftSort] = useState<BillingChargesSort>('created-at-desc');
  const loadingMoreRef = useRef(false);

  const loadCharges = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError(null);
    setLoadMoreError(null);
    try {
      const response = await billingService.listCharges({ period, origin, category, sort, search, offset: 0, limit: 20 });
      setCharges(response.charges);
      setOffset(response.offset + response.charges.length);
      setHasMore(response.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as cobranças.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [category, origin, period, search, sort]);

  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  useEffect(() => {
    setCategory(routeCategory);
    setDraftCategory(routeCategory);
  }, [routeCategory]);

  const loadMoreCharges = useCallback(async () => {
    if (loading || loadingMore || loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await billingService.listCharges({ period, origin, category, sort, search, offset, limit: 10 });
      setCharges((current) => {
        const existingIds = new Set(current.map(chargeKey));
        return [...current, ...response.charges.filter((charge) => !existingIds.has(chargeKey(charge)))];
      });
      setOffset(response.offset + response.charges.length);
      setHasMore(response.hasMore);
    } catch (loadError) {
      setLoadMoreError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar mais cobranças.');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [category, hasMore, loading, loadingMore, offset, origin, period, search, sort]);

  const { refreshing, refresh } = useAppRefresh(() => loadCharges({ silent: true }));

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

  const listHeader = (
    <View style={styles.headerContent}>
      <InlineSearchHeader
        title={origin === 'STANDALONE' ? 'Avulsas' : titleForCategory(category)}
        search={search}
        onSearchChange={setSearch}
        placeholder="Pesquisar cobrança"
        accessibilityLabel="Pesquisar cobranças"
        onBack={() => router.back()}
        onFilterPress={openFilters}
        filterActive={Boolean(category) || sort !== 'created-at-desc'}
      />

      <View style={styles.periodSwitch} accessibilityRole="tablist">
        <PeriodOption label="Este mês" active={period === 'this-month'} onPress={() => setPeriod('this-month')} />
        <PeriodOption label="Últimos 30 dias" active={period === 'last-30-days'} onPress={() => setPeriod('last-30-days')} />
      </View>
    </View>
  );

  return (
    <Screen backgroundColor={colors.surface} style={styles.screen} overlay={<BillingCreateFab />}>
      <FlatList
        data={loading ? [] : charges}
        keyExtractor={chargeKey}
        renderItem={({ item }) => <ChargeCard charge={item} onPress={() => router.push({ pathname: '/(app)/billing/[chargeId]', params: { chargeId: item.id } })} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={loading ? <BillingChargesSkeleton /> : error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadCharges()} /> : <EmptyState title="Nenhuma cobrança encontrada" message="As cobranças da conta aparecerão aqui quando forem geradas." />}
        ListFooterComponent={!loading && charges.length > 0 ? <BillingListFooter hasMore={hasMore} loading={loadingMore} error={loadMoreError} onRetry={() => void loadMoreCharges()} /> : null}
        contentContainerStyle={styles.listContent}
        onEndReached={() => void loadMoreCharges()}
        onEndReachedThreshold={0.45}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
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
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.periodOption, active ? styles.periodOptionActive : null, pressed ? styles.pressed : null]}><AppText style={{ color: active ? colors.brand : colors.ink }}>{label}</AppText></Pressable>;
}

function ChargeCard({ charge, onPress }: { charge: BillingCharge; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${charge.studentName}, ${charge.description}, ${charge.originalStatus}`} onPress={onPress} style={({ pressed }) => [styles.chargeCard, pressed ? styles.pressed : null]}>
      <View style={styles.chargeCopy}>
        <AppText variant="subheading" weight="medium" numberOfLines={1}>{charge.studentName}</AppText>
        <AppText tone="muted" numberOfLines={1}>{charge.description}</AppText>
        <View style={styles.chargeMeta}>
          <AppText variant="small" tone="muted">{charge.dueDate ? `Vencimento ${formatDate(charge.dueDate)}` : 'Sem vencimento'}</AppText>
        </View>
      </View>
      <View style={styles.chargeAmount}>
        <AppText variant="small" weight="medium" style={{ color: colorForCategory(charge.category) }}>{charge.originalStatus}</AppText>
        <AppText variant="body" weight="medium">{formatCurrency(charge.amount)}</AppText>
      </View>
      <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} style={styles.chargeArrow} />
    </Pressable>
  );
}

function BillingListFooter({ hasMore, loading, error, onRetry }: { hasMore: boolean; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <View style={styles.footer}><ActivityIndicator color={colors.brand} /><AppText variant="small" tone="muted">Carregando mais cobranças...</AppText></View>;
  if (error) return <View style={styles.footer}><AppText variant="small" tone="muted">{error}</AppText><Pressable accessibilityRole="button" onPress={onRetry}><AppText variant="small" weight="medium" style={{ color: colors.brand }}>Tentar novamente</AppText></Pressable></View>;
  if (!hasMore) return <AppText variant="small" tone="muted" style={styles.endMessage}>Fim da lista</AppText>;
  return null;
}

function BillingChargesSkeleton() {
  return (
    <View style={skeletonStyles.list} accessibilityLabel="Carregando cobranças">
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={skeletonStyles.card}>
          <View style={skeletonStyles.copy}><Skeleton width="76%" height={20} /><Skeleton width="50%" height={15} /><Skeleton width="58%" height={14} /></View>
          <View style={skeletonStyles.amount}><Skeleton width={70} height={16} /><Skeleton width={20} height={20} radius={radius.pill} /></View>
        </View>
      ))}
    </View>
  );
}

function chargeKey(charge: BillingCharge) { return `${charge.origin}:${charge.id}`; }
function colorForCategory(category: BillingCategory) {
  if (category === 'RECEIVED') return colors.success;
  if (category === 'CONFIRMED') return colors.info;
  if (category === 'AWAITING_PAYMENT') return colors.warning;
  if (category === 'CANCELLED') return colors.inkMuted;
  return colors.danger;
}
function formatCurrency(value: number) { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

const styles = StyleSheet.create({
  screen: { padding: 0 },
  listContent: { flexGrow: 1, gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing['2xl'] },
  headerContent: { gap: spacing.lg },
  periodSwitch: { minHeight: 54, flexDirection: 'row', alignItems: 'center', padding: 3, borderWidth: 2, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
  periodOption: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  periodOptionActive: { backgroundColor: colors.brandSoft },
  chargeCard: { position: 'relative', minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, paddingRight: spacing['3xl'], borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  chargeCopy: { minWidth: 0, flex: 1, justifyContent: 'center', gap: spacing.xs },
  chargeMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  chargeAmount: { minWidth: 96, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'flex-end', gap: spacing.xs, paddingTop: spacing.xl, paddingBottom: spacing.xs },
  chargeArrow: { position: 'absolute', top: spacing.md, right: spacing.lg },
  pressed: { opacity: 0.78 },
  footer: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  endMessage: { textAlign: 'center', paddingVertical: spacing.sm },
});

const skeletonStyles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { minHeight: 104, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, paddingRight: spacing['3xl'], borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  copy: { flex: 1, gap: spacing.xs },
  amount: { alignItems: 'flex-end', gap: spacing.sm },
});
