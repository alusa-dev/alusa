import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon, ChevronRightIcon } from 'react-native-heroicons/outline';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { AppText } from '@/components/primitives/AppText';
import { Screen } from '@/components/layout/Screen';
import { billingService } from '@/features/billing/services/billing-service';
import type { SubscriptionChargeItem, SubscriptionDetail, SubscriptionStatus } from '@/features/billing/types/billing';
import { colors, radius, spacing } from '@/theme/tokens';

export default function SubscriptionDetailScreen() {
  const { subscriptionId } = useLocalSearchParams<{ subscriptionId?: string }>();
  const resolvedId = Array.isArray(subscriptionId) ? subscriptionId[0] : subscriptionId;
  const [detail, setDetail] = useState<SubscriptionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const loadDetail = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!resolvedId) {
      setError('Assinatura inválida.');
      setLoading(false);
      return;
    }
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const response = await billingService.getSubscription(resolvedId);
      setDetail(response.detail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a assinatura.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [resolvedId]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try { await loadDetail({ silent: true }); } finally { refreshInFlight.current = false; setRefreshing(false); }
  }, [loadDetail]);

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen} refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar para assinaturas" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium" style={styles.headerTitle}>Detalhes da assinatura</AppText>
      </View>

      {loading ? <SubscriptionDetailSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadDetail()} /> : null}
      {!loading && !error && detail ? <SubscriptionDetailContent detail={detail} /> : null}
    </Screen>
  );
}

function SubscriptionDetailContent({ detail }: { detail: SubscriptionDetail }) {
  return (
    <View style={styles.content}>
      <View style={styles.summaryCard}>
        <View style={styles.summaryHero}>
          <AppText variant="small" tone="muted" numberOfLines={1} ellipsizeMode="tail">{detail.payerName}</AppText>
          <AppText variant="display" weight="medium">{formatCurrency(detail.value)}</AppText>
          <AppText variant="small" tone="muted" numberOfLines={1}>Cobrança recorrente · {detail.cycleLabel}</AppText>
          <StatusPill status={detail.status} />
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryGrid}>
          <View style={styles.summaryGridRow}>
            <SummaryItem label="Próximo vencimento" value={detail.nextDueDate ? formatDate(detail.nextDueDate) : 'Não informado'} />
            <SummaryItem label="Cobranças pagas" value={`${detail.paidCharges} de ${detail.totalCharges}`} />
          </View>
          <View style={styles.summaryGridRow}>
            <SummaryItem label="Forma de pagamento" value={paymentMethodFor(detail.billingType)} />
            <SummaryItem label="Criada em" value={formatDate(detail.createdAt)} />
          </View>
        </View>
      </View>

      {detail.description ? <View style={styles.descriptionCard}><AppText variant="small" tone="muted">Descrição</AppText><AppText weight="medium" numberOfLines={3}>{detail.description}</AppText></View> : null}

      <View style={styles.sectionHeader}>
        <AppText variant="subheading" weight="medium">Cobranças</AppText>
        <AppText variant="small" tone="muted">{detail.totalCharges}</AppText>
      </View>

      {detail.charges.length ? <View style={styles.chargeList}>{detail.charges.map((charge, index) => <SubscriptionChargeRow key={charge.id} charge={charge} isLast={index === detail.charges.length - 1} />)}</View> : <EmptyState title="Nenhuma cobrança encontrada" message="As cobranças recorrentes aparecerão aqui quando forem geradas." />}
    </View>
  );
}

function SubscriptionChargeRow({ charge, isLast }: { charge: SubscriptionChargeItem; isLast: boolean }) {
  const detailText = charge.dataPagamento ? `Pago em ${formatDate(charge.dataPagamento)}` : `Vencimento ${formatDate(charge.vencimento)}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir detalhes da cobrança ${charge.numero}, ${statusLabel(charge.status)}, ${formatCurrency(charge.valor)}`} onPress={() => router.push({ pathname: '/(app)/billing/[chargeId]', params: { chargeId: charge.id } })} style={({ pressed }) => [styles.chargeRow, isLast ? null : styles.chargeRowDivider, pressed ? styles.pressed : null]}><View style={styles.chargeNumber}><AppText variant="small" weight="medium">{charge.numero}</AppText></View><View style={styles.rowCopy}><AppText weight="medium" numberOfLines={1}>{`Cobrança ${charge.numero}`}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{detailText}</AppText></View><View style={styles.rowTrailing}><View style={styles.rowAmount}><ChargeStatusPill charge={charge} align="end" /><AppText variant="body" weight="medium" numberOfLines={1}>{formatCurrency(charge.valor)}</AppText></View><ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /></View></Pressable>;
}

function ChargeStatusPill({ charge, align = 'start' }: { charge: SubscriptionChargeItem; align?: 'start' | 'end' }) { const config = charge.displayStatus ? { label: charge.displayStatus.label, foreground: colorForVariant(charge.displayStatus.variant), background: backgroundForVariant(charge.displayStatus.variant) } : { label: statusLabel(charge.status), foreground: colorForCharge(charge.status), background: backgroundForCharge(charge.status) }; return <View style={[styles.statusPill, align === 'end' ? styles.statusPillRight : null, { backgroundColor: config.background }]}><View style={[styles.statusDot, { backgroundColor: config.foreground }]} /><AppText variant="tiny" weight="medium" style={{ color: config.foreground }}>{config.label}</AppText></View>; }
function StatusPill({ status }: { status: SubscriptionStatus }) { const config = { REQUESTED: { label: 'Solicitada', foreground: colors.warning, background: colors.accentSoft }, ACTIVE: { label: 'Ativa', foreground: colors.success, background: colors.accentSoft }, INACTIVE: { label: 'Inativa', foreground: colors.inkMuted, background: colors.surface }, EXPIRED: { label: 'Expirada', foreground: colors.danger, background: colors.dangerSoft }, DELETED: { label: 'Excluída', foreground: colors.inkMuted, background: colors.surface }, FAILED: { label: 'Falhou', foreground: colors.danger, background: colors.dangerSoft } }[status]; return <View style={[styles.statusPill, { backgroundColor: config.background }]}><View style={[styles.statusDot, { backgroundColor: config.foreground }]} /><AppText variant="tiny" weight="medium" style={{ color: config.foreground }}>{config.label}</AppText></View>; }
function SummaryItem({ label, value }: { label: string; value: string }) { return <View style={styles.summaryItem}><AppText variant="tiny" tone="muted" numberOfLines={1}>{label}</AppText><AppText variant="small" weight="medium" numberOfLines={1} ellipsizeMode="tail">{value}</AppText></View>; }
function statusLabel(status: string) { const labels: Record<string, string> = { PENDENTE: 'Pendente', A_VENCER: 'A vencer', PROCESSANDO: 'Processando', PAGO: 'Pago', PAID: 'Pago', ATRASADO: 'Em atraso', CANCELADO: 'Cancelado', CANCELED: 'Cancelado', ESTORNADO: 'Estornado', REFUNDED: 'Estornado' }; return labels[status] ?? status; }
function colorForCharge(status: string) { if (['PAGO', 'PAID'].includes(status)) return colors.success; if (['ATRASADO', 'OVERDUE'].includes(status)) return colors.danger; if (['CANCELADO', 'CANCELED', 'ESTORNADO', 'REFUNDED'].includes(status)) return colors.inkMuted; return colors.warning; }
function backgroundForCharge(status: string) { if (['PAGO', 'PAID'].includes(status)) return colors.accentSoft; if (['ATRASADO', 'OVERDUE'].includes(status)) return colors.dangerSoft; return colors.surface; }
function colorForVariant(variant: NonNullable<SubscriptionChargeItem['displayStatus']>['variant']) { return { success: colors.success, warning: colors.warning, danger: colors.danger, info: colors.info, neutral: colors.inkMuted }[variant]; }
function backgroundForVariant(variant: NonNullable<SubscriptionChargeItem['displayStatus']>['variant']) { return variant === 'danger' ? colors.dangerSoft : variant === 'success' || variant === 'warning' ? colors.accentSoft : colors.surface; }
function paymentMethodFor(value: string) { const labels: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto bancário', CREDIT_CARD: 'Cartão de crédito', CARTAO_CREDITO: 'Cartão de crédito', UNDEFINED: 'Cliente escolhe' }; return labels[value] ?? value; }
function formatCurrency(value: number) { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR'); }
function SubscriptionDetailSkeleton() { return <View style={styles.content} accessibilityLabel="Carregando detalhes da assinatura"><View style={styles.summaryCard}><View style={styles.summaryHero}><Skeleton width="55%" height={17} /><Skeleton width="48%" height={36} /><Skeleton width="48%" height={17} /><Skeleton width={76} height={24} radius={radius.pill} /></View><View style={styles.summaryDivider} /><View style={styles.summaryGrid}><View style={styles.summaryGridRow}>{[0, 1].map((item) => <View key={item} style={styles.summaryItem}><Skeleton width="72%" height={14} /><Skeleton width="86%" height={18} /></View>)}</View><View style={styles.summaryGridRow}>{[2, 3].map((item) => <View key={item} style={styles.summaryItem}><Skeleton width="72%" height={14} /><Skeleton width="86%" height={18} /></View>)}</View></View></View><View style={styles.sectionHeader}><Skeleton width="30%" height={24} /><Skeleton width={16} height={16} /></View><View style={styles.chargeList}>{[0, 1, 2, 3, 4].map((item) => <View key={item} style={[styles.chargeRow, item < 4 ? styles.chargeRowDivider : null]}><Skeleton width={34} height={34} radius={radius.pill} /><View style={styles.rowCopy}><Skeleton width="66%" height={18} /><Skeleton width="92%" height={14} /></View><View style={styles.rowTrailing}><View style={styles.rowAmount}><Skeleton width={76} height={18} /><Skeleton width={84} height={18} /></View><Skeleton width={20} height={20} /></View></View>)}</View></View>; }

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: 116 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  headerTitle: { flex: 1 },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { gap: spacing.lg },
  summaryCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  summaryHero: { gap: spacing.sm },
  descriptionCard: { gap: spacing.xs, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  summaryDivider: { height: 1, backgroundColor: colors.border },
  summaryGrid: { gap: spacing.lg },
  summaryGridRow: { flexDirection: 'row', gap: spacing.xl },
  summaryItem: { flex: 1, minWidth: 0, gap: spacing.xs },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chargeList: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  chargeRow: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chargeRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  chargeNumber: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  rowCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowAmount: { width: 86, alignItems: 'flex-end', gap: spacing.xs },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  statusPillRight: { alignSelf: 'flex-end' },
  statusDot: { width: 6, height: 6, borderRadius: radius.pill },
  pressed: { opacity: 0.78 },
});
