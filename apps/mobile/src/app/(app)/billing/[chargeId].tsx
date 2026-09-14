import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Share, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeftIcon, ArrowUturnLeftIcon, BanknotesIcon, DocumentTextIcon, EllipsisVerticalIcon, PencilSquareIcon, ReceiptRefundIcon, ShareIcon, XCircleIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Screen } from '@/components/layout/Screen';
import { BottomSheet } from '@/components/overlays/BottomSheet';
import { AppText } from '@/components/primitives/AppText';
import { billingService, type BillingChargeAction } from '@/features/billing/services/billing-service';
import type { BillingCategory, BillingCharge } from '@/features/billing/types/billing';
import { formatCurrency, formatDate } from '@/features/billing/utils/formatters';
import { colors, radius, spacing } from '@/theme/tokens';
import { useAppRefresh } from '@/hooks/use-app-refresh';

export default function BillingChargeScreen() {
  const { chargeId } = useLocalSearchParams<{ chargeId?: string }>();
  const [charge, setCharge] = useState<BillingCharge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState<BillingChargeAction | null>(null);

  const loadCharge = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!chargeId) {
      setError('Cobrança não encontrada.');
      setLoading(false);
      return;
    }
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const response = await billingService.getCharge(chargeId);
      setCharge(response.charge);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a cobrança.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [chargeId]);

  useEffect(() => {
    void loadCharge();
  }, [loadCharge]);

  const { refreshing, refresh } = useAppRefresh(() => loadCharge({ silent: true }));

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen} refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium" style={styles.headerTitle}>Detalhes da cobrança</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Mais ações" hitSlop={10} onPress={() => setActionsVisible(true)} style={styles.headerAction}>
          <EllipsisVerticalIcon color={colors.ink} size={24} strokeWidth={1.8} />
        </Pressable>
      </View>

      {loading ? <BillingChargeSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadCharge()} /> : null}
      {!loading && !error && charge ? <ChargeDetails charge={charge} onEdit={() => router.push({ pathname: '/(app)/billing/[chargeId]/edit', params: { chargeId: charge.id } })} onEditRules={() => router.push({ pathname: '/(app)/billing/[chargeId]/edit-rules', params: { chargeId: charge.id } })} /> : null}
      <ChargeActions
        charge={charge}
        visible={actionsVisible}
        actionLoading={actionLoading}
        onClose={() => setActionsVisible(false)}
        onAction={async (action) => {
          setActionLoading(action);
          try {
            const result = await billingService.executeAction(chargeId ?? '', action);
            setActionsVisible(false);
            await refresh();
            Alert.alert('Ação enviada', result.message);
          } catch (actionError) {
            Alert.alert('Não foi possível concluir', actionError instanceof Error ? actionError.message : 'Tente novamente.');
          } finally {
            setActionLoading(null);
          }
        }}
      />
    </Screen>
  );
}

function ChargeDetails({ charge, onEdit, onEditRules }: { charge: BillingCharge; onEdit: () => void; onEditRules: () => void }) {
  const statusColor = colorForCategory(charge.category);
  return (
    <View style={styles.content}>
      <View style={styles.hero}>
        <AppText variant="small" tone="muted">{charge.studentName}</AppText>
        <AppText variant="display" weight="medium">{formatCurrency(charge.amount)}</AppText>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18` }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <AppText variant="small" weight="medium" style={{ color: statusColor }}>{charge.originalStatus}</AppText>
        </View>
      </View>

      <View style={styles.detailsCard}>
        {charge.capabilities.canEdit ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Editar cobrança" hitSlop={8} onPress={onEdit} style={[styles.cardEditButton, styles.detailsEditButton]}>
            <PencilSquareIcon color={colors.brand} size={21} strokeWidth={1.8} />
          </Pressable>
        ) : null}
        <DetailRow label="Descrição" value={charge.description} />
        <View style={styles.detailGrid}>
          <DetailRow label="Vencimento" value={charge.dueDate ? formatDate(charge.dueDate) : 'Não informado'} />
          <DetailRow label="Data de criação" value={charge.createdAt ? formatDate(charge.createdAt) : 'Não informado'} />
        </View>
        <DetailRow label="Forma de pagamento" value={formatPaymentMethod(charge.paymentMethod)} />
        {charge.paidAt ? <DetailRow label="Pagamento em" value={formatDate(charge.paidAt)} /> : null}
      </View>

      <ChargeRules charge={charge} onEdit={onEditRules} />
      <ChargeDocuments charge={charge} />
    </View>
  );
}

function BillingChargeSkeleton() {
  return (
    <View style={skeletonStyles.content} accessibilityLabel="Carregando detalhes da cobrança">
      <View style={skeletonStyles.hero}>
        <Skeleton width="62%" height={18} />
        <Skeleton width="42%" height={42} />
        <Skeleton width={116} height={34} radius={radius.pill} />
      </View>
      <View style={skeletonStyles.card}>
        <Skeleton width="34%" height={15} /><Skeleton width="72%" height={20} />
        <View style={skeletonStyles.grid}><View style={skeletonStyles.gridItem}><Skeleton width="68%" height={15} /><Skeleton width="82%" height={18} /></View><View style={skeletonStyles.gridItem}><Skeleton width="68%" height={15} /><Skeleton width="82%" height={18} /></View></View>
        <Skeleton width="42%" height={15} /><Skeleton width="60%" height={20} />
      </View>
      <View style={skeletonStyles.card}><Skeleton width="54%" height={22} /><Skeleton width="82%" height={18} /><Skeleton width="68%" height={18} /><Skeleton width="72%" height={18} /></View>
      <View style={skeletonStyles.card}><Skeleton width="48%" height={22} /><Skeleton width="78%" height={18} /></View>
    </View>
  );
}

function ChargeRules({ charge, onEdit }: { charge: BillingCharge; onEdit: () => void }) {
  const rules = charge.financialRules ?? {
    interestPercent: null,
    finePercent: null,
    discountValue: null,
    discountType: null,
    discountDueDateLimitDays: null,
  };
  const hasRules = rules.interestPercent !== null || rules.finePercent !== null || rules.discountValue !== null;

  return (
    <Pressable
      accessibilityRole={charge.capabilities.canEditRules ? 'button' : undefined}
      accessibilityLabel={charge.capabilities.canEditRules ? 'Editar juros, multa e desconto' : undefined}
      disabled={!charge.capabilities.canEditRules}
      onPress={charge.capabilities.canEditRules ? onEdit : undefined}
      style={({ pressed }) => [styles.sectionCard, charge.capabilities.canEditRules && pressed ? styles.pressed : null]}
    >
      <View style={styles.sectionHeader}>
        <AppText variant="subheading" weight="medium">Juros, multa e desconto</AppText>
        {charge.capabilities.canEditRules ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Editar juros, multa e desconto" hitSlop={8} onPress={onEdit} style={styles.cardEditButton}>
            <PencilSquareIcon color={colors.brand} size={21} strokeWidth={1.8} />
          </Pressable>
        ) : null}
      </View>
      {hasRules ? (
        <View style={styles.rulesList}>
          <RuleRow label="Juros ao mês" value={formatPercentage(rules.interestPercent)} />
          <RuleRow label="Multa" value={formatPercentage(rules.finePercent)} />
          <RuleRow label="Desconto" value={formatDiscount(rules.discountValue, rules.discountType)} />
          {rules.discountDueDateLimitDays !== null ? (
            <RuleRow label="Prazo do desconto" value={rules.discountDueDateLimitDays === 0 ? 'Até o vencimento' : `${rules.discountDueDateLimitDays} dias antes`} />
          ) : null}
        </View>
      ) : (
        <AppText tone="muted">Nenhum encargo ou desconto configurado.</AppText>
      )}
    </Pressable>
  );
}

function ChargeDocuments({ charge }: { charge: BillingCharge }) {
  const documents = [
    charge.invoiceUrl ? { label: 'Fatura da cobrança', url: charge.invoiceUrl } : null,
    charge.bankSlipUrl ? { label: 'Boleto bancário', url: charge.bankSlipUrl } : null,
  ].filter((document): document is { label: string; url: string } => Boolean(document));

  return (
    <View style={styles.sectionCard}>
      <AppText variant="subheading" weight="medium">Documentos da cobrança</AppText>
      {documents.length > 0 ? documents.map((document) => (
        <Pressable
          key={document.label}
          accessibilityRole="button"
          accessibilityLabel={`Abrir ${document.label}`}
          onPress={() => void Linking.openURL(document.url)}
          style={({ pressed }) => [styles.documentRow, pressed ? styles.pressed : null]}
        >
          <AppText weight="medium">{document.label}</AppText>
          <AppText tone="muted">Abrir</AppText>
        </Pressable>
      )) : <AppText tone="muted">Nenhum documento disponível para esta cobrança.</AppText>}
    </View>
  );
}

function ChargeActions({
  charge,
  visible,
  actionLoading,
  onClose,
  onAction,
}: {
  charge: BillingCharge | null;
  visible: boolean;
  actionLoading: BillingChargeAction | null;
  onClose: () => void;
  onAction: (action: BillingChargeAction) => Promise<void>;
}) {
  if (!charge) return null;
  const requestAction = (action: BillingChargeAction, title: string, message: string) => {
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Confirmar', onPress: () => void onAction(action) },
    ]);
  };

  const renderAction = (action: BillingChargeAction, label: string, Icon: typeof ShareIcon, onPress: () => void) => (
    <Pressable
      key={action}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={actionLoading !== null}
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, pressed ? styles.pressed : null, actionLoading === action ? styles.actionRowLoading : null]}
    >
      <View style={styles.actionContent}>
        <Icon color={colors.brand} size={23} strokeWidth={1.8} />
        <AppText weight="medium">{actionLoading === action ? 'Processando…' : label}</AppText>
      </View>
    </Pressable>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="80%" accessibilityLabel="Ações da cobrança">
      <AppText variant="subheading" weight="medium">Ações da cobrança</AppText>
      <View style={styles.actionList}>
        <Pressable accessibilityRole="button" onPress={() => { onClose(); void Share.share({ message: `${charge.description} — ${formatCurrency(charge.amount)}` }); }} style={styles.actionRow}>
          <View style={styles.actionContent}>
            <ShareIcon color={colors.brand} size={23} strokeWidth={1.8} />
            <AppText weight="medium">Compartilhar cobrança</AppText>
          </View>
        </Pressable>
        {charge.invoiceUrl || charge.bankSlipUrl ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              void Linking.openURL(charge.invoiceUrl ?? charge.bankSlipUrl ?? '');
            }}
            style={styles.actionRow}
          >
            <View style={styles.actionContent}>
              <DocumentTextIcon color={colors.brand} size={23} strokeWidth={1.8} />
              <AppText weight="medium">Visualizar documento</AppText>
            </View>
          </Pressable>
        ) : null}
        {charge.capabilities.canConfirmCashPayment ? renderAction('CONFIRM_CASH_PAYMENT', 'Confirmar recebimento em dinheiro', BanknotesIcon, () => requestAction('CONFIRM_CASH_PAYMENT', 'Confirmar recebimento?', 'A cobrança será enviada ao Asaas como recebida em dinheiro.')) : null}
        {charge.capabilities.canCancel ? renderAction('CANCEL', 'Cancelar cobrança', XCircleIcon, () => requestAction('CANCEL', 'Cancelar cobrança?', 'A cobrança será cancelada e permanecerá no histórico financeiro.')) : null}
        {charge.capabilities.canUndoCashPayment ? renderAction('UNDO_CASH_PAYMENT', 'Desfazer recebimento em dinheiro', ArrowUturnLeftIcon, () => requestAction('UNDO_CASH_PAYMENT', 'Desfazer recebimento?', 'O status retornará ao fluxo de cobrança após a confirmação do Asaas.')) : null}
        {charge.capabilities.canRefund ? renderAction('REFUND', 'Solicitar estorno', ReceiptRefundIcon, () => requestAction('REFUND', 'Solicitar estorno?', 'O estorno será enviado ao Asaas e o status final será atualizado por webhook.')) : null}
      </View>
    </BottomSheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <AppText variant="small" tone="muted">{label}</AppText>
      <AppText variant="body" weight="medium" numberOfLines={2} style={styles.detailValue}>{value}</AppText>
    </View>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.ruleRow}>
      <AppText variant="small" tone="muted">{label}</AppText>
      <AppText weight="medium">{value}</AppText>
    </View>
  );
}

function colorForCategory(category: BillingCategory) {
  if (category === 'RECEIVED') return colors.success;
  if (category === 'CONFIRMED') return colors.info;
  if (category === 'AWAITING_PAYMENT') return colors.warning;
  return colors.danger;
}

function formatPaymentMethod(value: string | null) {
  switch (value?.toUpperCase()) {
    case 'PIX': return 'Pix';
    case 'BOLETO': return 'Boleto';
    case 'CREDIT_CARD': return 'Cartão de crédito';
    case 'CARTAO_CREDITO': return 'Cartão de crédito';
    case 'DEBIT_CARD': return 'Cartão de débito';
    case 'CARTAO_DEBITO': return 'Cartão de débito';
    case 'RECEIVED_IN_CASH': return 'Dinheiro';
    case 'DINHEIRO': return 'Dinheiro';
    default: return value || 'Não informado';
  }
}

function formatPercentage(value: number | null) {
  return value === null ? 'Não informado' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatDiscount(value: number | null, type: string | null) {
  if (value === null) return 'Não informado';
  const normalizedType = type?.toUpperCase();
  return normalizedType?.includes('PERCENT')
    ? `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : formatCurrency(value);
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing['2xl'] },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  backButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1 },
  headerAction: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { gap: spacing.xl },
  hero: { gap: spacing.sm, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  statusBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  statusDot: { width: 9, height: 9, borderRadius: radius.pill },
  detailsCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  cardEditButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  detailsEditButton: { position: 'absolute', top: spacing.md, right: spacing.md, zIndex: 1 },
  detailGrid: { flexDirection: 'row', gap: spacing.lg },
  detailRow: { gap: spacing.xs },
  detailValue: { color: colors.ink },
  sectionCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  rulesList: { gap: spacing.lg },
  ruleRow: { gap: spacing.xs },
  documentRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  pressed: { opacity: 0.76 },
  actionRow: { minHeight: 64, justifyContent: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  actionContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionList: { gap: 0 },
  actionRowLoading: { opacity: 0.58 },
});

const skeletonStyles = StyleSheet.create({
  content: { gap: spacing.xl },
  hero: { gap: spacing.sm, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  card: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surfaceNeutral },
  grid: { flexDirection: 'row', gap: spacing.lg },
  gridItem: { flex: 1, gap: spacing.xs },
});
