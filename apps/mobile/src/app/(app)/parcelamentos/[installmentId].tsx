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
import type { InstallmentDetail, InstallmentItem, InstallmentPlanStatus } from '@/features/billing/types/billing';
import { colors, radius, spacing } from '@/theme/tokens';

export default function InstallmentDetailScreen() {
  const { installmentId } = useLocalSearchParams<{ installmentId?: string }>();
  const resolvedId = Array.isArray(installmentId) ? installmentId[0] : installmentId;
  const [detail, setDetail] = useState<InstallmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const loadDetail = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!resolvedId) {
      setError('Parcelamento inválido.');
      setLoading(false);
      return;
    }
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const response = await billingService.getInstallment(resolvedId);
      setDetail(response.detail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o parcelamento.');
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
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar para parcelamentos" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium" style={styles.headerTitle}>Detalhes do parcelamento</AppText>
      </View>

      {loading ? <InstallmentDetailSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadDetail()} /> : null}
      {!loading && !error && detail ? <InstallmentDetailContent detail={detail} /> : null}
    </Screen>
  );
}

function InstallmentDetailContent({ detail }: { detail: InstallmentDetail }) {
  return (
    <View style={styles.content}>
      <View style={styles.summaryCard}>
        <View style={styles.summaryHero}>
          <AppText variant="small" tone="muted" numberOfLines={1} ellipsizeMode="tail">{detail.cliente}</AppText>
          <AppText variant="display" weight="medium">{formatCurrency(detail.valorTotal)}</AppText>
          <StatusPill status={detail.status} />
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryGrid}>
          <View style={styles.summaryGridRow}>
            <SummaryItem label="Parcelas pagas" value={`${Math.min(detail.parcelasPagas, detail.numeroParcelas)} de ${detail.numeroParcelas}`} />
            <SummaryItem label="Primeiro vencimento" value={formatDate(detail.firstDueDate)} />
          </View>
          <View style={styles.summaryGridRow}>
            <SummaryItem label="Forma de pagamento" value={paymentMethodFor(detail.billingType)} />
            <SummaryItem label="Criado em" value={formatDate(detail.createdAt)} />
          </View>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <AppText variant="subheading" weight="medium">Parcelas</AppText>
        <AppText variant="small" tone="muted">{detail.parcelas.length}</AppText>
      </View>

      {detail.parcelas.length ? <View style={styles.installmentList}>{detail.parcelas.map((item, index) => <InstallmentRow key={item.id} item={item} isLast={index === detail.parcelas.length - 1} />)}</View> : <EmptyState title="Nenhuma parcela encontrada" message="As parcelas aparecerão aqui quando forem geradas." />}
    </View>
  );
}

function InstallmentRow({ item, isLast }: { item: InstallmentItem; isLast: boolean }) {
  const virtual = item.id.startsWith('virtual-');
  const detailText = item.dataPagamento ? `Pago em ${formatDate(item.dataPagamento)}` : `Vencimento ${formatDate(item.vencimento)}`;
  const rowStyle = [styles.installmentRow, isLast ? null : styles.installmentRowDivider, virtual ? styles.installmentRowDisabled : null];
  const content = <><View style={styles.installmentNumber}><AppText variant="small" weight="medium">{item.numero}</AppText></View><View style={styles.rowCopy}><AppText weight="medium" numberOfLines={1}>{`Parcela ${item.numero}`}</AppText><AppText variant="small" tone="muted" numberOfLines={1}>{detailText}</AppText></View><View style={styles.rowTrailing}><View style={styles.rowAmount}><StatusPill status={statusFor(item.status)} align="end" /><AppText variant="body" weight="medium" numberOfLines={1}>{formatCurrency(item.valor)}</AppText></View>{!virtual ? <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /> : null}</View></>;
  if (virtual) return <View accessibilityLabel={`Parcela ${item.numero}, aguardando geração`} style={rowStyle}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir detalhes da parcela ${item.numero}, ${statusLabel(item.status)}, ${formatCurrency(item.valor)}`} onPress={() => router.push({ pathname: '/(app)/billing/[chargeId]', params: { chargeId: item.id } })} style={({ pressed }) => [...rowStyle, pressed ? styles.pressed : null]}>{content}</Pressable>;
}

function SummaryItem({ label, value }: { label: string; value: string }) { return <View style={styles.summaryItem}><AppText variant="tiny" tone="muted" numberOfLines={1}>{label}</AppText><AppText variant="small" weight="medium" numberOfLines={1} ellipsizeMode="tail">{value}</AppText></View>; }
function StatusPill({ status, align = 'start' }: { status: InstallmentPlanStatus; align?: 'start' | 'end' }) { const config = { EM_DIA: { label: 'Em dia', background: colors.accentSoft, foreground: colors.success }, ATRASADO: { label: 'Atrasado', background: colors.dangerSoft, foreground: colors.danger }, QUITADO: { label: 'Quitado', background: colors.accentSoft, foreground: colors.success }, CANCELADO: { label: 'Cancelado', background: colors.surface, foreground: colors.inkMuted } }[status]; return <View style={[styles.statusPill, align === 'end' ? styles.statusPillRight : null, { backgroundColor: config.background }]}><View style={[styles.statusDot, { backgroundColor: config.foreground }]} /><AppText variant="tiny" weight="medium" style={{ color: config.foreground }}>{config.label}</AppText></View>; }
function statusFor(status: string): InstallmentPlanStatus { const normalized = status.toUpperCase(); if (['PAGO', 'PAID', 'RECEBIDO'].includes(normalized)) return 'QUITADO'; if (['ATRASADO', 'OVERDUE'].includes(normalized)) return 'ATRASADO'; if (['CANCELADO', 'CANCELED', 'CANCELLED'].includes(normalized)) return 'CANCELADO'; return 'EM_DIA'; }
function statusLabel(status: string) { const normalized = status.toUpperCase(); if (normalized === 'PAGO' || normalized === 'PAID') return 'Pago'; if (normalized === 'ATRASADO' || normalized === 'OVERDUE') return 'Em atraso'; if (normalized.includes('CANCEL')) return 'Cancelada'; return 'Em aberto'; }
function paymentMethodFor(value: string) { const labels: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto bancário', CREDIT_CARD: 'Cartão de crédito', CARTAO_CREDITO: 'Cartão de crédito', UNDEFINED: 'Cliente escolhe' }; return labels[value] ?? value; }
function formatCurrency(value: number) { return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Não informado' : date.toLocaleDateString('pt-BR'); }

function InstallmentDetailSkeleton() { return <View style={styles.content} accessibilityLabel="Carregando detalhes do parcelamento"><View style={styles.summaryCard}><View style={styles.summaryHero}><Skeleton width="55%" height={17} /><Skeleton width="48%" height={36} /><Skeleton width={76} height={24} radius={radius.pill} /></View><View style={styles.summaryDivider} /><View style={styles.summaryGrid}><View style={styles.summaryGridRow}>{[0, 1].map((item) => <View key={item} style={styles.summaryItem}><Skeleton width="72%" height={14} /><Skeleton width="86%" height={18} /></View>)}</View><View style={styles.summaryGridRow}>{[2, 3].map((item) => <View key={item} style={styles.summaryItem}><Skeleton width="72%" height={14} /><Skeleton width="86%" height={18} /></View>)}</View></View></View><View style={styles.sectionHeader}><Skeleton width="30%" height={24} /><Skeleton width={16} height={16} /></View><View style={styles.installmentList}>{[0, 1, 2, 3, 4].map((item) => <View key={item} style={[styles.installmentRow, item < 4 ? styles.installmentRowDivider : null]}><Skeleton width={34} height={34} radius={radius.pill} /><View style={styles.rowCopy}><Skeleton width="66%" height={18} /><Skeleton width="92%" height={14} /></View><View style={styles.rowTrailing}><View style={styles.rowAmount}><Skeleton width={76} height={18} /><Skeleton width={84} height={18} /></View><Skeleton width={20} height={20} /></View></View>)}</View></View>; }

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: 116 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  headerTitle: { flex: 1 },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { gap: spacing.lg },
  summaryCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  summaryHero: { gap: spacing.sm },
  summaryDivider: { height: 1, backgroundColor: colors.border },
  summaryGrid: { gap: spacing.lg },
  summaryGridRow: { flexDirection: 'row', gap: spacing.xl },
  summaryItem: { flex: 1, minWidth: 0, gap: spacing.xs },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  installmentList: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  installmentRow: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  installmentRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  installmentRowDisabled: { opacity: 0.6 },
  installmentNumber: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  rowCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowAmount: { width: 86, alignItems: 'flex-end', gap: spacing.xs },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  statusPillRight: { alignSelf: 'flex-end' },
  statusDot: { width: 6, height: 6, borderRadius: radius.pill },
  pressed: { opacity: 0.78 },
});
