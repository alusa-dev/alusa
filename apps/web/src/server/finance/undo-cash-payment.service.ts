import { randomUUID } from 'crypto';
import {
  KycNotApprovedError,
  auditLogService,
  evaluatePaymentActionPolicy,
  isAsaasEnabled,
  normalizeAsaasPaymentSnapshotStatus,
  readPaymentFullPreflight,
  runAsaasPaymentCommand,
  syncPaymentStateFromAsaas,
  undoCashPayment,
} from '@alusa/finance';
import { cobrancaActionResultDTOSchema } from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaActionResultToDTO } from '@/features/financeiro/cobrancas/mappers';
import {
  loadCobrancaActionRecords,
  recordCobrancaFinancialLog,
  resolveCobrancaPaymentLookupForTenant,
} from './resolve-cobranca-payment-lookup';

const CASH_UNDO_ALREADY_APPLIED_STATUSES = new Set(['PENDING', 'OVERDUE']);

type UndoCashResult = { status: number; body: unknown };

function result(status: number, body: unknown): UndoCashResult {
  return { status, body };
}

function resolveAcademicPaymentOrigin(tipo?: string | null) {
  switch (tipo) {
    case 'PARCELADA': return 'INSTALLMENT' as const;
    case 'RECORRENTE': return 'SUBSCRIPTION' as const;
    case 'TAXA_MATRICULA': return 'ENROLLMENT_FEE' as const;
    case 'AVULSA': return 'STANDALONE' as const;
    default: return 'ACADEMIC' as const;
  }
}

function getEffectiveAsaasStatus(payment: {
  status?: string | null;
  billingType?: string | null;
  deleted?: boolean | null;
}) {
  return normalizeAsaasPaymentSnapshotStatus({
    status: payment.status,
    billingType: payment.billingType,
    deleted: payment.deleted,
  }) ?? payment.status ?? 'PENDING';
}

function mappedResponse(message: string, correlationId: string, pending: boolean) {
  return cobrancaActionResultDTOSchema.parse(mapCobrancaActionResultToDTO({
    success: true,
    message,
    pending,
    correlationId,
  }));
}

async function reconcileAlreadyUndone(params: {
  contaId: string;
  asaasPaymentId: string;
  correlationId: string;
  source: string;
}) {
  try {
    await syncPaymentStateFromAsaas({
      contaId: params.contaId,
      asaasPaymentId: params.asaasPaymentId,
      eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
    });
  } catch (error) {
    console.warn('[Undo Receive In Cash] Falha ao reconciliar recebimento já desfeito', {
      ...params,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function executeUndo(params: {
  contaId: string;
  userId: string;
  role?: string;
  id: string;
  asaasPayment: Awaited<ReturnType<typeof readPaymentFullPreflight>>;
  effectiveStatus: string;
  correlationId: string;
  startedAt: number;
  entityType: 'COBRANCA' | 'CHARGE';
  entityId: string;
  chargeId?: string | null;
  cobrancaId?: string | null;
  origin?: string;
  financialLog?: boolean;
}) {
  const { commandJobId } = await runAsaasPaymentCommand({
    contaId: params.contaId,
    type: 'PAYMENT_UNDO_CASH_COMMAND',
    entityType: params.entityType,
    entityId: params.entityId,
    asaasPaymentId: params.asaasPayment.id,
    correlationId: params.correlationId,
    actorId: params.userId,
    ...(params.chargeId !== undefined ? { chargeId: params.chargeId } : {}),
    ...(params.cobrancaId !== undefined ? { cobrancaId: params.cobrancaId } : {}),
    metadata: {
      source: 'POST /api/cobrancas/[id]/undo-receive-in-cash',
      ...(params.origin ? { origin: params.origin } : {}),
      previousAsaasStatus: params.asaasPayment.status,
      previousEffectiveAsaasStatus: params.effectiveStatus,
    },
    providerStatus: params.effectiveStatus,
    run: () => undoCashPayment(params.asaasPayment.id, { contaId: params.contaId }),
  });

  try {
    await syncPaymentStateFromAsaas({
      contaId: params.contaId,
      asaasPaymentId: params.asaasPayment.id,
      eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
    });
  } catch (error) {
    console.warn('[Undo Receive In Cash] Falha ao sincronizar estado pós-comando', {
      correlationId: params.correlationId,
      commandJobId,
      asaasPaymentId: params.asaasPayment.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.charge.undo_cash_payment_requested',
    entity: { type: params.entityType === 'COBRANCA' ? 'Cobranca' : 'Charge', id: params.entityId },
    metadata: {
      correlationId: params.correlationId,
      asaasPaymentId: params.asaasPayment.id,
      ...(params.origin ? { origin: params.origin } : {}),
      previousAsaasStatus: params.asaasPayment.status,
      previousEffectiveAsaasStatus: params.effectiveStatus,
      requestedBy: params.userId,
      requestedByRole: params.role,
      durationMs: Date.now() - params.startedAt,
    },
  });

  if (params.financialLog) {
    await recordCobrancaFinancialLog({
      contaId: params.contaId,
      usuarioId: params.userId,
      cobrancaId: params.cobrancaId ?? null,
      acao: 'DESFAZER_RECEBIMENTO_DINHEIRO',
      detalhes: {
        cobrancaId: params.id,
        entityType: params.entityType,
        asaasPaymentId: params.asaasPayment.id,
        correlationId: params.correlationId,
        commandJobId,
        previousAsaasStatus: params.asaasPayment.status,
        previousEffectiveAsaasStatus: params.effectiveStatus,
      },
    });
  }

  return result(202, mappedResponse(
    params.origin === 'EVENT'
      ? 'Desfazer recebimento solicitado. Status será atualizado via webhook.'
      : 'Solicitação enviada. Status será atualizado via webhook.',
    params.correlationId,
    true,
  ));
}

export async function executeUndoCashPayment(params: {
  contaId: string;
  userId: string;
  role?: string;
  id: string;
}): Promise<UndoCashResult> {
  const correlationId = randomUUID();
  const startedAt = Date.now();
  try {
    const records = await loadCobrancaActionRecords(params.contaId, params.id);
    if (!records.cobranca && !records.charge) {
      const lookup = await resolveCobrancaPaymentLookupForTenant(params.contaId, params.id);
      if (!lookup) return result(404, { error: 'Cobrança não encontrada', correlationId });
      if (!lookup.asaasPaymentId) return result(400, { error: 'Cobrança sem integração Asaas', correlationId });
      if (!isAsaasEnabled()) return result(503, { error: 'Integração Asaas desabilitada', correlationId });
      const payment = await readPaymentFullPreflight(lookup.asaasPaymentId, { contaId: params.contaId });
      const effectiveStatus = getEffectiveAsaasStatus(payment);
      if (CASH_UNDO_ALREADY_APPLIED_STATUSES.has(effectiveStatus)) {
        await reconcileAlreadyUndone({ contaId: params.contaId, asaasPaymentId: lookup.asaasPaymentId, correlationId, source: 'lookup' });
        return result(200, mappedResponse('Recebimento em dinheiro já estava desfeito no Asaas. Estado local reconciliado.', correlationId, false));
      }
      const policy = evaluatePaymentActionPolicy({
        entityType: 'COBRANCA',
        origin: 'EVENT',
        localStatus: lookup.localStatus,
        asaasStatus: effectiveStatus,
        billingType: payment.billingType ?? lookup.billingType,
        hasAsaasPaymentId: true,
        hasInvoiceUrl: Boolean(lookup.invoiceUrl),
        wasReceivedInCash: effectiveStatus === 'RECEIVED_IN_CASH',
      });
      if (!policy.canUndoCashPayment) {
        const decision = policy.actions.UNDO_CASH_PAYMENT;
        return result(400, { error: decision.reason ?? `Operação não permitida. Status atual no Asaas: ${payment.status}`, correlationId, asaasStatus: effectiveStatus, code: decision.code, ...(decision.hint ? { hint: decision.hint } : {}) });
      }
      return executeUndo({ ...params, asaasPayment: payment, effectiveStatus, correlationId, startedAt, entityType: 'CHARGE', entityId: params.id, origin: 'EVENT' });
    }

    const asaasPaymentId = records.cobranca?.asaasPaymentId ?? records.charge?.asaasPaymentId ?? null;
    if (!asaasPaymentId) return result(400, { error: 'Cobrança sem integração Asaas', correlationId });
    if (!isAsaasEnabled()) return result(503, { error: 'Integração Asaas desabilitada', correlationId });
    const payment = await readPaymentFullPreflight(asaasPaymentId, { contaId: params.contaId });
    const effectiveStatus = getEffectiveAsaasStatus(payment);

    if (CASH_UNDO_ALREADY_APPLIED_STATUSES.has(effectiveStatus)) {
      await reconcileAlreadyUndone({ contaId: params.contaId, asaasPaymentId, correlationId, source: records.cobranca ? 'cobranca' : 'charge' });
      await auditLogService.record({
        contaId: params.contaId,
        action: 'finance.charge.undo_cash_payment_already_applied',
        entity: { type: records.cobranca ? 'Cobranca' : 'Charge', id: records.cobranca?.id ?? records.charge!.id },
        metadata: { correlationId, asaasPaymentId, currentAsaasStatus: payment.status, currentEffectiveAsaasStatus: effectiveStatus, requestedBy: params.userId, requestedByRole: params.role, durationMs: Date.now() - startedAt },
      });
      return result(200, mappedResponse('Recebimento em dinheiro já estava desfeito no Asaas. Estado local reconciliado.', correlationId, false));
    }

    const policy = evaluatePaymentActionPolicy({
      entityType: records.cobranca ? 'COBRANCA' : 'CHARGE',
      origin: records.cobranca
        ? resolveAcademicPaymentOrigin(records.cobranca.tipo)
        : records.charge?.standaloneInstallmentPlanId
          ? 'INSTALLMENT'
          : records.charge?.standaloneSubscriptionId
            ? 'SUBSCRIPTION'
            : 'STANDALONE',
      localStatus: records.cobranca?.status ?? records.charge?.status ?? null,
      asaasStatus: effectiveStatus,
      billingType: payment.billingType ?? records.charge?.billingType ?? null,
      hasAsaasPaymentId: true,
      hasInvoiceUrl: Boolean(records.cobranca?.charge?.invoiceUrl || records.charge?.invoiceUrl),
      wasReceivedInCash: effectiveStatus === 'RECEIVED_IN_CASH',
      isInstallmentPayment: records.cobranca?.tipo === 'PARCELADA' || Boolean(records.charge?.standaloneInstallmentPlanId),
      isSubscriptionPayment: records.cobranca?.tipo === 'RECORRENTE' || Boolean(records.charge?.standaloneSubscriptionId),
    });
    if (!policy.canUndoCashPayment) {
      const decision = policy.actions.UNDO_CASH_PAYMENT;
      return result(400, { error: decision.reason ?? `Operação não permitida. Status atual no Asaas: ${payment.status}`, correlationId, asaasStatus: effectiveStatus, code: decision.code, ...(decision.hint ? { hint: decision.hint } : {}) });
    }
    return executeUndo({
      ...params,
      asaasPayment: payment,
      effectiveStatus,
      correlationId,
      startedAt,
      entityType: records.cobranca ? 'COBRANCA' : 'CHARGE',
      entityId: records.cobranca?.id ?? records.charge!.id,
      chargeId: records.charge?.id ?? null,
      cobrancaId: records.cobranca?.id ?? null,
      financialLog: true,
    });
  } catch (error) {
    console.error('[Undo Receive In Cash] Erro:', error);
    if (error instanceof KycNotApprovedError) return result(409, { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras', correlationId });
    return result(500, {
      error: 'Erro ao desfazer recebimento em dinheiro',
      message: 'Não foi possível desfazer o recebimento agora.',
      correlationId,
    });
  }
}

export { cobrancaActionResultDTOSchema };
