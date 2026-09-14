import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRightIcon } from 'react-native-heroicons/outline';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { InlineSearchHeader } from '@/components/layout/InlineSearchHeader';
import { FilterOptionSheet } from '@/components/overlays/FilterOptionSheet';
import { AppText } from '@/components/primitives/AppText';
import { BillingCreateFab } from '@/features/billing/components/BillingCreateFab';
import { billingService } from '@/features/billing/services/billing-service';
import type { InstallmentPlan, InstallmentPlanStatus } from '@/features/billing/types/billing';
import { colors, radius, spacing } from '@/theme/tokens';

type InstallmentStatusFilter = 'ALL' | InstallmentPlanStatus;

const installmentStatusOptions = [
  { value: 'ALL', label: 'Todos os parcelamentos' },
  { value: 'EM_DIA', label: 'Em dia' },
  { value: 'ATRASADO', label: 'Atrasados' },
  { value: 'QUITADO', label: 'Quitados' },
  { value: 'CANCELADO', label: 'Cancelados' },
];

export default function InstallmentsScreen() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InstallmentStatusFilter>('ALL');
  const [filterVisible, setFilterVisible] = useState(false);
  const [items, setItems] = useState<InstallmentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const refreshInFlight = useRef(false);

  const loadInstallments = useCallback(async (page = 1, options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(page === 1);
    setError(null);
    try {
      const response = await billingService.listInstallments({ page, pageSize: 20, search });
      setItems((current) => page === 1 ? response.items : [...current, ...response.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      pageRef.current = response.page;
      setHasMore(response.page < response.totalPages);
    } catch (loadError) {
      if (page === 1) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os parcelamentos.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadInstallments();
  }, [loadInstallments]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await loadInstallments(1, { silent: true });
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [loadInstallments]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      await loadInstallments(pageRef.current + 1, { silent: true });
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadInstallments, loading, loadingMore]);

  const visibleItems = useMemo(() => statusFilter === 'ALL' ? items : items.filter((item) => item.statusConsolidado === statusFilter), [items, statusFilter]);

  const header = (
    <View style={styles.headerContent}>
      <InlineSearchHeader
        title="Parcelamentos"
        search={search}
        onSearchChange={setSearch}
        placeholder="Pesquisar parcelamento"
        accessibilityLabel="Pesquisar parcelamentos"
        onBack={() => router.back()}
        onFilterPress={() => setFilterVisible(true)}
        filterActive={statusFilter !== 'ALL'}
      />
      <AppText variant="small" tone="muted">Acompanhe o andamento das cobranças parceladas.</AppText>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <FlatList
        data={loading ? [] : visibleItems}
        keyExtractor={(item) => `${item.origin}:${item.id}`}
        renderItem={({ item }) => <InstallmentCard item={item} onPress={() => router.push({ pathname: '/(app)/parcelamentos/[installmentId]', params: { installmentId: item.id } })} />}
        ListHeaderComponent={header}
        ListEmptyComponent={loading ? <InstallmentsSkeleton /> : error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadInstallments()} /> : <EmptyState title="Nenhum parcelamento encontrado" message={search || statusFilter !== 'ALL' ? 'Revise a busca ou o filtro e tente novamente.' : 'Os parcelamentos da conta aparecerão aqui quando forem criados.'} />}
        ListFooterComponent={loadingMore ? <View style={styles.footer}><ActivityIndicator color={colors.brand} /><AppText variant="small" tone="muted">Carregando mais parcelamentos...</AppText></View> : null}
        contentContainerStyle={styles.listContent}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.45}
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
      <FilterOptionSheet
        visible={filterVisible}
        title="Filtrar parcelamentos"
        value={statusFilter}
        clearValue="ALL"
        options={installmentStatusOptions}
        onChange={(value) => setStatusFilter(value as InstallmentStatusFilter)}
        onClose={() => setFilterVisible(false)}
        accessibilityLabel="Filtrar parcelamentos"
      />
      <BillingCreateFab />
    </SafeAreaView>
  );
}

function InstallmentCard({ item, onPress }: { item: InstallmentPlan; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Parcelamento de ${item.payerName}`} onPress={onPress} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.cardCopy}>
        <AppText variant="subheading" weight="medium" numberOfLines={1} ellipsizeMode="tail">{item.payerName}</AppText>
        <AppText variant="small" tone="muted" numberOfLines={1}>Parcelamento · {item.installmentsPaid} de {item.installmentCount} parcelas</AppText>
        <AppText variant="tiny" tone="muted" numberOfLines={1}>Próximo vencimento: {item.proximoVencimento ? formatDate(item.proximoVencimento) : 'Concluído'}</AppText>
      </View>
      <View style={styles.cardAmount}>
        <StatusPill status={item.statusConsolidado} />
        <AppText variant="body" weight="medium">{formatCurrency(item.totalValue)}</AppText>
      </View>
      <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} style={styles.cardArrow} />
    </Pressable>
  );
}

function StatusPill({ status }: { status: InstallmentPlanStatus }) {
  const config = {
    EM_DIA: { label: 'Em dia', background: colors.accentSoft, foreground: colors.success },
    ATRASADO: { label: 'Atrasado', background: colors.dangerSoft, foreground: colors.danger },
    QUITADO: { label: 'Quitado', background: colors.accentSoft, foreground: colors.success },
    CANCELADO: { label: 'Cancelado', background: colors.surface, foreground: colors.inkMuted },
  }[status];
  return <View style={[styles.statusPill, { backgroundColor: config.background }]}><View style={[styles.statusDot, { backgroundColor: config.foreground }]} /><AppText variant="tiny" weight="medium" style={{ color: config.foreground }}>{config.label}</AppText></View>;
}

function InstallmentsSkeleton() {
  return <View style={styles.skeletonList} accessibilityLabel="Carregando parcelamentos">{[0, 1, 2, 3].map((item) => <View key={item} style={styles.skeletonCard}><View style={styles.cardCopy}><Skeleton width="68%" height={20} /><Skeleton width="78%" height={15} /><Skeleton width="58%" height={14} /></View><View style={styles.skeletonAmount}><Skeleton width={72} height={18} /><Skeleton width={84} height={18} /></View></View>)}</View>;
}

function formatCurrency(value: number) { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR'); }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  listContent: { flexGrow: 1, gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing['2xl'] },
  headerContent: { gap: spacing.lg },
  card: { position: 'relative', minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, paddingRight: spacing['3xl'], borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  cardCopy: { minWidth: 0, flex: 1, justifyContent: 'center', gap: spacing.xs },
  cardAmount: { minWidth: 108, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'flex-end', gap: spacing.xs, paddingTop: spacing.xl },
  cardArrow: { position: 'absolute', top: spacing.md, right: spacing.lg },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  statusDot: { width: 6, height: 6, borderRadius: radius.pill },
  skeletonList: { gap: spacing.md },
  skeletonCard: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  skeletonAmount: { alignItems: 'flex-end', gap: spacing.sm },
  footer: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  pressed: { opacity: 0.78 },
});
