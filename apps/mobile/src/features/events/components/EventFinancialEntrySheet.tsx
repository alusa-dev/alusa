import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/overlays/BottomSheet';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileEventFinancialEntry } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

import { EventFinancialEditSheet, FinancialEntrySummary } from './EventFinancialSheet';

export function EventFinancialEntrySheet({
  eventId,
  entry,
  visible,
  canManage,
  onClose,
  onChanged,
}: {
  eventId: string;
  entry: MobileEventFinancialEntry | null;
  visible: boolean;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [partialRefundVisible, setPartialRefundVisible] = useState(false);
  const [refundText, setRefundText] = useState('');

  const isManual = entry?.originType === 'MANUAL';
  const isMobileReadOnlyCategory = entry?.category === 'Inscrição' || entry?.category === 'Taxa de inscrição';
  const isPending = isManual && (entry?.status === 'EXPECTED' || entry?.status === 'PENDING');
  const hasReceivedValue = Boolean(entry && ['PAID', 'RECEIVED', 'PARTIALLY_REFUNDED'].includes(entry.status) && (entry.actualAmount ?? 0) > 0);
  const remainingRefundable = useMemo(() => {
    if (!entry) return 0;
    return Math.max((entry.actualAmount ?? entry.expectedAmount) - entry.refundedAmount, 0);
  }, [entry]);

  if (!entry) return null;
  const currentEntry = entry;

  async function update(payload: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      await eventsService.updateFinancialEntry(eventId, currentEntry.id, payload);
      await onChanged();
      Alert.alert('Lançamento atualizado', successMessage);
      onClose();
    } catch (reason) {
      Alert.alert('Não foi possível atualizar', reason instanceof Error ? reason.message : 'Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  function markAsRealized() {
    const status = currentEntry.type === 'COST' ? 'PAID' : 'RECEIVED';
    void update({
      status,
      actualAmount: currentEntry.actualAmount ?? currentEntry.expectedAmount,
      realizedAt: currentEntry.realizedAt ?? new Date().toISOString(),
      paymentMethod: currentEntry.paymentMethod ?? 'OTHER',
    }, status === 'PAID' ? 'Custo marcado como pago.' : 'Receita marcada como recebida.');
  }

  function cancelEntry() {
    Alert.alert(
      'Cancelar lançamento?',
      'O lançamento será preservado no histórico e deixará de compor o resultado do evento.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Cancelar lançamento',
          style: 'destructive',
          onPress: () => void update({ status: 'CANCELLED', actualAmount: null, refundedAmount: 0, realizedAt: null }, 'Lançamento cancelado.'),
        },
      ],
    );
  }

  function fullRefund() {
    const label = currentEntry.type === 'COST' ? 'Estornar pagamento' : 'Estornar recebimento';
    Alert.alert(
      `${label}?`,
      currentEntry.type === 'COST'
        ? 'O custo será marcado como estornado e deixará de compor os custos pagos.'
        : 'A receita será marcada como estornada e deixará de compor as receitas recebidas.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: label,
          style: 'destructive',
          onPress: () => void update({
            status: 'REFUNDED',
            actualAmount: currentEntry.actualAmount ?? currentEntry.expectedAmount,
            realizedAt: currentEntry.realizedAt ?? new Date().toISOString(),
            refundedAmount: currentEntry.actualAmount ?? currentEntry.expectedAmount,
          }, `${label} concluído.`),
        },
      ],
    );
  }

  async function partialRefund() {
    const amount = parseAmount(refundText);
    if (amount <= 0 || amount >= remainingRefundable) {
      Alert.alert('Valor inválido', 'Informe um valor maior que zero e menor que o saldo disponível para estorno.');
      return;
    }
    setPartialRefundVisible(false);
    setRefundText('');
    await update({
      status: 'PARTIALLY_REFUNDED',
      actualAmount: currentEntry.actualAmount ?? currentEntry.expectedAmount,
      realizedAt: currentEntry.realizedAt ?? new Date().toISOString(),
      refundedAmount: currentEntry.refundedAmount + amount,
    }, 'Estorno parcial concluído.');
  }

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} maxHeight="82%" accessibilityLabel="Detalhes do lançamento">
        <View style={styles.sheetContent}>
          <View style={styles.headerCopy}>
            <AppText variant="subheading" weight="medium">Detalhes do lançamento</AppText>
            <AppText variant="small" tone="muted" numberOfLines={2}>{currentEntry.description}</AppText>
          </View>
          <View style={styles.summaryCard}>
            <FinancialEntrySummary entry={currentEntry} />
          </View>

          {currentEntry.notes ? <View style={styles.notes}><AppText variant="small" tone="muted">Observações</AppText><AppText>{currentEntry.notes}</AppText></View> : null}
          {currentEntry.originType !== 'MANUAL' ? <View style={styles.infoBox}><AppText variant="small" tone="muted">Este lançamento é automático e deve ser corrigido pela origem: {originLabel(currentEntry.originType).toLowerCase()}.</AppText></View> : null}

          {canManage && isManual && !isMobileReadOnlyCategory ? (
            <View style={styles.actions}>
              {isPending ? <Button title={currentEntry.type === 'COST' ? 'Marcar como pago' : 'Marcar como recebido'} loading={busy} onPress={markAsRealized} /> : null}
              {isPending ? <Button title="Editar lançamento" variant="ghost" disabled={busy} onPress={() => setEditVisible(true)} /> : null}
              {isPending ? <Button title="Cancelar lançamento" variant="ghost" disabled={busy} onPress={cancelEntry} /> : null}
              {hasReceivedValue && remainingRefundable > 0 ? (
                <>
                  {currentEntry.type === 'REVENUE' && remainingRefundable > 0 ? <Button title="Estorno parcial" variant="ghost" disabled={busy} onPress={() => setPartialRefundVisible(true)} /> : null}
                  <Button title={currentEntry.type === 'COST' ? 'Estornar pagamento' : 'Estornar recebimento'} variant="ghost" disabled={busy} onPress={fullRefund} />
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      </BottomSheet>

      <EventFinancialEditSheet
        eventId={eventId}
        entry={currentEntry}
        visible={editVisible}
        onClose={() => setEditVisible(false)}
        onSaved={async () => {
          await onChanged();
          setEditVisible(false);
          onClose();
        }}
      />

      <BottomSheet visible={partialRefundVisible} onClose={() => setPartialRefundVisible(false)} maxHeight="46%" accessibilityLabel="Estorno parcial">
        <View style={styles.sheetContent}>
          <View style={styles.headerCopy}>
            <AppText variant="subheading" weight="medium">Estorno parcial</AppText>
            <AppText variant="small" tone="muted">Saldo disponível: {formatCurrency(remainingRefundable)}.</AppText>
          </View>
          <TextField label="Valor estornado" value={refundText} onChangeText={setRefundText} placeholder="R$ 0,00" keyboardType="decimal-pad" />
          <Button title="Confirmar estorno" loading={busy} onPress={() => void partialRefund()} />
        </View>
      </BottomSheet>
    </>
  );
}

function parseAmount(value: string) {
  const normalized = value.replace(/[^\d,]/g, '').replace(',', '.');
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

function originLabel(origin: string) {
  if (origin === 'TICKET_SALE') return 'venda de ingresso';
  if (origin === 'COSTUME_ASSIGNMENT') return 'vínculo do figurino';
  if (origin === 'COSTUME') return 'figurino';
  return 'origem do lançamento';
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

const styles = StyleSheet.create({
  sheetContent: { gap: spacing.lg },
  headerCopy: { gap: spacing.xs },
  summaryCard: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  summaryRows: { gap: spacing.md },
  notes: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  infoBox: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
