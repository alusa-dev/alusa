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
import type { SubscriptionPlan, SubscriptionStatus } from '@/features/billing/types/billing';
import { colors, radius, spacing } from '@/theme/tokens';

type SubscriptionStatusFilter = 'ALL' | SubscriptionStatus;

const subscriptionStatusOptions = [
  { value: 'ALL', label: 'Todas as assinaturas' },
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'INACTIVE', label: 'Inativas' },
  { value: 'EXPIRED', label: 'Expiradas' },
  { value: 'REQUESTED', label: 'Solicitadas' },
  { value: 'FAILED', label: 'Com falha' },
  { value: 'DELETED', label: 'Excluídas' },
];

export default function SubscriptionsScreen() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatusFilter>('ALL');
  const [filterVisible, setFilterVisible] = useState(false);
  const [items, setItems] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const refreshInFlight = useRef(false);

  const loadSubscriptions = useCallback(async (page = 1, options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(page === 1);
    setError(null);
    try {
      const response = await billingService.listSubscriptions({ page, pageSize: 20, search });
      setItems((current) => page === 1 ? response.items : [...current, ...response.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      pageRef.current = response.page;
      setHasMore(response.page < response.totalPages);
    } catch (loadError) {
      if (page === 1) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as assinaturas.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [search]);

  useEffect(() => { void loadSubscriptions(); }, [loadSubscriptions]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try { await loadSubscriptions(1, { silent: true }); } finally { refreshInFlight.current = false; setRefreshing(false); }
  }, [loadSubscriptions]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try { await loadSubscriptions(pageRef.current + 1, { silent: true }); } finally { setLoadingMore(false); }
  }, [hasMore, loadSubscriptions, loading, loadingMore]);

  const visibleItems = useMemo(() => statusFilter === 'ALL' ? items : items.filter((item) => item.status === statusFilter), [items, statusFilter]);

  const header = (
    <View style={styles.headerContent}>
      <InlineSearchHeader
        title="Assinaturas"
        search={search}
        onSearchChange={setSearch}
        placeholder="Pesquisar assinatura"
        accessibilityLabel="Pesquisar assinaturas"
        onBack={() => router.back()}
        onFilterPress={() => setFilterVisible(true)}
        filterActive={statusFilter !== 'ALL'}
      />
      <AppText variant="small" tone="muted">Acompanhe as cobranças recorrentes da conta.</AppText>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <FlatList
        data={loading ? [] : visibleItems}
        keyExtractor={(item) => `${item.type}:${item.id}`}
        renderItem={({ item }) => <SubscriptionCard item={item} onPress={() => router.push({ pathname: '/(app)/assinaturas/[subscriptionId]', params: { subscriptionId: item.id } })} />}
        ListHeaderComponent={header}
        ListEmptyComponent={loading ? <SubscriptionsSkeleton /> : error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadSubscriptions()} /> : <EmptyState title="Nenhuma assinatura encontrada" message={search || statusFilter !== 'ALL' ? 'Revise a busca ou o filtro e tente novamente.' : 'As assinaturas da conta aparecerão aqui quando forem criadas.'} />}
        ListFooterComponent={loadingMore ? <View style={styles.footer}><ActivityIndicator color={colors.brand} /><AppText variant="small" tone="muted">Carregando mais assinaturas...</AppText></View> : null}
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
        title="Filtrar assinaturas"
        value={statusFilter}
        clearValue="ALL"
        options={subscriptionStatusOptions}
        onChange={(value) => setStatusFilter(value as SubscriptionStatusFilter)}
        onClose={() => setFilterVisible(false)}
        accessibilityLabel="Filtrar assinaturas"
      />
      <BillingCreateFab />
    </SafeAreaView>
  );
}

function SubscriptionCard({ item, onPress }: { item: SubscriptionPlan; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Assinatura de ${item.payerName}`} onPress={onPress} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}><View style={styles.cardCopy}><AppText variant="subheading" weight="medium" numberOfLines={1} ellipsizeMode="tail">{item.payerName}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{item.description || 'Assinatura'} · {item.cycleLabel}</AppText><AppText variant="tiny" tone="muted" numberOfLines={1}>Próximo vencimento: {item.nextDueDate ? formatDate(item.nextDueDate) : 'Não informado'}</AppText></View><View style={styles.cardAmount}><StatusPill status={item.status} /><AppText variant="body" weight="medium">{formatCurrency(item.value)}</AppText></View><ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} style={styles.cardArrow} /></Pressable>;
}

function StatusPill({ status }: { status: SubscriptionStatus }) {
  const config = statusConfig(status);
  return <View style={[styles.statusPill, { backgroundColor: config.background }]}><View style={[styles.statusDot, { backgroundColor: config.foreground }]} /><AppText variant="tiny" weight="medium" style={{ color: config.foreground }}>{config.label}</AppText></View>;
}

function statusConfig(status: SubscriptionStatus) {
  const configs: Record<SubscriptionStatus, { label: string; background: string; foreground: string }> = {
    REQUESTED: { label: 'Solicitada', background: colors.accentSoft, foreground: colors.warning },
    ACTIVE: { label: 'Ativa', background: colors.accentSoft, foreground: colors.success },
    INACTIVE: { label: 'Inativa', background: colors.surface, foreground: colors.inkMuted },
    EXPIRED: { label: 'Expirada', background: colors.dangerSoft, foreground: colors.danger },
    DELETED: { label: 'Excluída', background: colors.surface, foreground: colors.inkMuted },
    FAILED: { label: 'Falhou', background: colors.dangerSoft, foreground: colors.danger },
  };
  return configs[status];
}

function SubscriptionsSkeleton() { return <View style={styles.skeletonList} accessibilityLabel="Carregando assinaturas">{[0, 1, 2, 3].map((item) => <View key={item} style={styles.skeletonCard}><View style={styles.cardCopy}><Skeleton width="68%" height={20} /><Skeleton width="78%" height={15} /><Skeleton width="58%" height={14} /></View><View style={styles.skeletonAmount}><Skeleton width={72} height={18} /><Skeleton width={84} height={18} /></View></View>)}</View>; }
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
