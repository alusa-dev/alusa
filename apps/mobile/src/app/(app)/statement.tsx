import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ArrowDownCircleIcon, ArrowLeftIcon, ArrowUpCircleIcon, FunnelIcon } from 'react-native-heroicons/outline';
import { router } from 'expo-router';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { useAppRefresh } from '@/hooks/use-app-refresh';
import { StatementFilterSheet } from '@/features/statement/components/StatementFilterSheet';
import { StatementExportFab } from '@/features/statement/components/StatementExportFab';
import { StatementSkeleton } from '@/features/statement/components/StatementSkeleton';
import { statementService } from '@/features/statement/services/statement-service';
import type {
  StatementDirection,
  StatementPeriod,
  StatementResponse,
  StatementTransaction,
} from '@/features/statement/types/statement';
import { formatDate } from '@/features/billing/utils/formatters';
import { colors, radius, shadows, spacing } from '@/theme/tokens';

const PAGE_SIZE = 20;

export default function StatementScreen() {
  const [period, setPeriod] = useState<StatementPeriod>('this-month');
  const [direction, setDirection] = useState<StatementDirection>('desc');
  const [draftPeriod, setDraftPeriod] = useState<StatementPeriod>('this-month');
  const [draftDirection, setDraftDirection] = useState<StatementDirection>('desc');
  const [data, setData] = useState<StatementResponse | null>(null);
  const [transactions, setTransactions] = useState<StatementTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);

  const loadStatement = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const response = await statementService.get({ period, direction, page: 1, pageSize: PAGE_SIZE });
      setData(response);
      setTransactions(response.transactions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o extrato agora.');
      if (!options.silent) {
        setData(null);
        setTransactions([]);
      }
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [direction, period]);

  useEffect(() => {
    void loadStatement();
  }, [loadStatement]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !data?.pagination.hasNextPage) return;
    setLoadingMore(true);
    try {
      const response = await statementService.get({
        period,
        direction,
        page: data.pagination.page + 1,
        pageSize: PAGE_SIZE,
      });
      setData(response);
      setTransactions((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        return [...current, ...response.transactions.filter((item) => !existingIds.has(item.id))];
      });
    } finally {
      setLoadingMore(false);
    }
  }, [data, direction, loading, loadingMore, period]);

  const { refreshing, refresh } = useAppRefresh(
    () => loadStatement({ silent: true }),
    { intervalMs: null },
  );

  const openFilters = useCallback(() => {
    setDraftPeriod(period);
    setDraftDirection(direction);
    setFilterVisible(true);
  }, [direction, period]);

  const applyFilters = useCallback(() => {
    setPeriod(draftPeriod);
    setDirection(draftDirection);
    setFilterVisible(false);
  }, [draftDirection, draftPeriod]);

  const clearFilters = useCallback(() => {
    setDraftPeriod('this-month');
    setDraftDirection('desc');
  }, []);

  return (
    <Screen
      scroll
      backgroundColor={colors.surface}
      style={styles.screen}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      overlay={<StatementExportFab />}
    >
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium" style={styles.headerTitle}>Extrato</AppText>
      </View>

      {loading ? <StatementSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadStatement()} /> : null}
      {!loading && !error && data ? <SummaryCard summary={data.summary} /> : null}

      {!loading && !error ? (
        <View style={styles.movementsSection}>
          <View style={styles.sectionHeader}>
            <AppText variant="subheading" weight="medium">Últimas movimentações</AppText>
            <Pressable accessibilityRole="button" accessibilityLabel="Filtrar movimentações" hitSlop={8} onPress={openFilters} style={styles.filterButton}>
              <FunnelIcon color={colors.brand} size={23} strokeWidth={1.8} />
            </Pressable>
          </View>
          {transactions.length === 0 ? (
            <EmptyState title="Nenhuma movimentação encontrada" message="As movimentações financeiras aparecerão aqui quando estiverem disponíveis." />
          ) : (
            transactions.map((transaction) => <MovementRow key={transaction.id} transaction={transaction} />)
          )}
          {data?.pagination.hasNextPage ? (
            <Pressable accessibilityRole="button" onPress={() => void loadMore()} disabled={loadingMore} style={({ pressed }) => [styles.loadMore, pressed ? styles.pressed : null, loadingMore ? styles.disabled : null]}>
              {loadingMore ? <Skeleton width={116} height={16} radius={radius.sm} /> : <AppText weight="medium" style={styles.loadMoreText}>Carregar mais</AppText>}
            </Pressable>
          ) : transactions.length > 0 ? <AppText variant="small" tone="muted" style={styles.endMessage}>Fim da lista</AppText> : null}
        </View>
      ) : null}

      <StatementFilterSheet
        visible={filterVisible}
        period={draftPeriod}
        direction={draftDirection}
        onPeriodChange={setDraftPeriod}
        onDirectionChange={setDraftDirection}
        onClear={clearFilters}
        onApply={applyFilters}
        onClose={() => setFilterVisible(false)}
      />
    </Screen>
  );
}

function SummaryCard({ summary }: { summary: StatementResponse['summary'] }) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <AppText variant="subheading" weight="medium">Visão geral do saldo</AppText>
      </View>
      <View style={styles.summaryBody}>
        <SummaryMetric label="Saldo disponível para uso" value={summary.available} tone={colors.brand} />
        <SummaryMetric label="Aguardando pagamento dos clientes" value={summary.awaitingPayment} tone={colors.warning} />
        <SummaryMetric label="Realizados e aguardando repasse" value={summary.awaitingSettlement} tone={colors.warning} last />
      </View>
    </View>
  );
}

function SummaryMetric({ label, value, tone, last = false }: { label: string; value: number; tone: string; last?: boolean }) {
  return (
    <View style={[styles.summaryMetric, last ? styles.summaryMetricLast : null]}>
      <AppText tone="muted" style={styles.summaryMetricLabel}>{label}</AppText>
      <AppText variant="heading" weight="medium" style={{ color: tone }}>{formatCurrency(value)}</AppText>
    </View>
  );
}

function MovementRow({ transaction }: { transaction: StatementTransaction }) {
  const positive = transaction.grossValue >= 0;
  const Icon = positive ? ArrowDownCircleIcon : ArrowUpCircleIcon;
  const title = transaction.customerName?.trim() || movementTypeLabel(transaction.type);
  const description = transaction.chargeName?.trim() || friendlyDescription(transaction.description);

  return (
    <View style={styles.movementCard}>
      <Icon color={positive ? colors.success : colors.danger} size={28} strokeWidth={1.8} />
      <View style={styles.movementCopy}>
        <AppText weight="medium" numberOfLines={1} style={styles.movementTitle}>{title}</AppText>
        <AppText variant="small" tone="muted" numberOfLines={2}>{description}</AppText>
        <AppText variant="tiny" tone="subtle">{formatDate(transaction.date)}</AppText>
      </View>
      <View style={styles.movementAside}>
        <AppText variant="tiny" weight="medium" numberOfLines={1} style={{ color: positive ? colors.success : colors.danger }}>{movementTypeLabel(transaction.type)}</AppText>
        <AppText weight="medium" style={{ color: positive ? colors.success : colors.danger }}>{formatSignedCurrency(transaction.grossValue)}</AppText>
      </View>
    </View>
  );
}

function movementTypeLabel(type: StatementTransaction['type']) {
  switch (type) {
    case 'RECEITA': return 'Recebimento';
    case 'TAXA': return 'Taxa';
    case 'ESTORNO': return 'Estorno';
    case 'TRANSFERENCIA': return 'Transferência';
    case 'ANTECIPACAO': return 'Antecipação';
    default: return 'Ajuste financeiro';
  }
}

function friendlyDescription(value: string) {
  return value.replace(/asaas/gi, 'serviço financeiro').replace(/payment/gi, 'pagamento');
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatSignedCurrency(value: number) {
  return `${value >= 0 ? '+' : '-'} ${formatCurrency(Math.abs(value))}`;
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 },
  summaryCard: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral, ...shadows.soft },
  summaryHeader: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.xl },
  summaryBody: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  summaryMetric: { gap: spacing.xs, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryMetricLast: { borderBottomWidth: 0 },
  summaryMetricLabel: { fontSize: 16, lineHeight: 22 },
  movementsSection: { gap: spacing.md },
  sectionHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  filterButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  movementCard: { position: 'relative', minHeight: 108, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, paddingRight: spacing['3xl'], borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  movementCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  movementTitle: { minWidth: 0, flex: 1 },
  movementAside: { minWidth: 96, alignItems: 'flex-end', gap: spacing.xs },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  loadMoreText: { color: colors.brand },
  endMessage: { textAlign: 'center', paddingVertical: spacing.lg },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
});
