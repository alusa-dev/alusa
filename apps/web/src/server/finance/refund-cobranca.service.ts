import { randomUUID } from 'crypto';
import {
  AsaasHttpError,
  KycNotApprovedError,
  auditLogService,
  evaluatePaymentActionPolicy,
  expectedEventsForPaymentCommand,
  failPaymentCommand,
  isAsaasEnabled,
  markPaymentCommandSent,
  normalizeAsaasPaymentSnapshotStatus,
  readPaymentFullPreflight,
  refundCobranca,
  registerPaymentCommand,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import type { CobrancaRefundInputDTO } from '@/features/financeiro/cobrancas/dtos';
import {
  cobrancaActionResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaActionResultToDTO } from '@/features/financeiro/cobrancas/mappers';
import {
  loadCobrancaActionRecords,
  recordCobrancaFinancialLog,
  resolveCobrancaPaymentLookupForTenant,
} from './resolve-cobranca-payment-lookup';

type RefundCommandResult = { status: number; body: unknown };

function result(status: number, body: unknown): RefundCommandResult {
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

function policyFailure(policy: { actions: { REFUND: { reason?: string; code?: string; hint?: string }; PARTIAL_REFUND: { reason?: string; code?: string; hint?: string } } }, effectiveStatus: string, correlationId: string, partial: boolean) {
  const decision = partial ? policy.actions.PARTIAL_REFUND : policy.actions.REFUND;
  return result(400, {
    error: decision.reason ?? (partial ? 'Estorno parcial não permitido.' : 'Operação de estorno não permitida.'),
    correlationId,
    asaasStatus: effectiveStatus,
    code: decision.code,
    ...(decision.hint ? { hint: decision.hint } : {}),
    ...(!partial && decision.code === 'REFUND_NOT_ALLOWED_FOR_CASH_PAYMENT'
      ? { expectedAction: 'UNDO_CASH_PAYMENT' }
      : {}),
  });
}

function validateRefundValue(params: {
  value: number | undefined;
  paymentValue: number;
  correlationId: string;
  event: boolean;
}): RefundCommandResult | null {
  if (params.value === undefined) return null;
  if (params.value <= 0) {
    return result(400, {
      error: params.event ? 'Valor de estorno deve ser positivo' : 'Valor do estorno deve ser maior que zero',
      correlationId: params.correlationId,
    });
  }
  if (params.value > params.paymentValue) {
    return result(400, {
      error: params.event
        ? 'Valor de estorno não pode exceder o valor da cobrança'
        : 'Valor de estorno não pode ser maior que o valor pago',
      correlationId: params.correlationId,
      ...(params.event ? {} : { paymentValue: params.paymentValue, requestedValue: params.value }),
    });
  }
  return null;
}

async function executeRefundCommand(params: {
  contaId: string;
  userId: string;
  role?: string;
  id: string;
  body: CobrancaRefundInputDTO;
  correlationId: string;
  startedAt: number;
  asaasPayment: Awaited<ReturnType<typeof readPaymentFullPreflight>>;
  effectiveAsaasStatus: string;
  paymentValue: number;
  entityType: 'COBRANCA' | 'CHARGE';
  entityId: string;
  origin?: string;
  chargeId?: string | null;
  cobrancaId?: string | null;
  financialLog?: boolean;
}): Promise<RefundCommandResult> {
  const refundValue = params.body.value;
  const command = await registerPaymentCommand({
    contaId: params.contaId,
    type: 'PAYMENT_REFUND_COMMAND',
    entityType: params.entityType,
    entityId: params.entityId,
    asaasPaymentId: params.asaasPayment.id,
    expectedEvents: expectedEventsForPaymentCommand('PAYMENT_REFUND_COMMAND'),
    correlationId: params.correlationId,
    actorId: params.userId,
    ...(params.chargeId !== undefined ? { chargeId: params.chargeId } : {}),
    ...(params.cobrancaId !== undefined ? { cobrancaId: params.cobrancaId } : {}),
    metadata: {
      source: 'POST /api/cobrancas/[id]/refund',
      ...(params.origin ? { origin: params.origin } : {}),
      previousAsaasStatus: params.asaasPayment.status,
      previousEffectiveAsaasStatus: params.effectiveAsaasStatus,
      refundValue: refundValue ?? params.paymentValue,
      isPartialRefund: refundValue !== undefined && refundValue < params.paymentValue,
      splitRefunds: params.body.splitRefunds ?? null,
    },
  });

  try {
    await refundCobranca({
      paymentId: params.asaasPayment.id,
      contaId: params.contaId,
      value: refundValue,
      description: params.body.description || `Estorno solicitado via Alusa - ${params.correlationId}`,
      splitRefunds: params.body.splitRefunds,
    });
    await markPaymentCommandSent({ jobId: command.id, providerStatus: params.effectiveAsaasStatus });
  } catch (error) {
    await failPaymentCommand({ jobId: command.id, error });
    throw error;
  }

  try {
    await syncPaymentStateFromAsaas({ contaId: params.contaId, asaasPaymentId: params.asaasPayment.id });
  } catch (error) {
    console.warn('[Refund] Falha ao sincronizar estado pós-comando', {
      correlationId: params.correlationId,
      commandJobId: command.id,
      asaasPaymentId: params.asaasPayment.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.charge.refund_requested',
    entity: { type: params.entityType === 'COBRANCA' ? 'Cobranca' : 'Charge', id: params.entityId },
    metadata: {
      correlationId: params.correlationId,
      asaasPaymentId: params.asaasPayment.id,
      ...(params.origin ? { origin: params.origin } : {}),
      previousAsaasStatus: params.asaasPayment.status,
      refundValue: refundValue ?? params.paymentValue,
      isPartialRefund: refundValue !== undefined && refundValue < params.paymentValue,
      description: params.body.description,
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
      acao: 'ESTORNAR_COBRANCA',
      detalhes: {
        cobrancaId: params.id,
        entityType: params.entityType,
        asaasPaymentId: params.asaasPayment.id,
        correlationId: params.correlationId,
        commandJobId: command.id,
        previousAsaasStatus: params.asaasPayment.status,
        refundValue: refundValue ?? params.paymentValue,
        isPartialRefund: refundValue !== undefined && refundValue < params.paymentValue,
        description: params.body.description,
      },
    });
  }

  return result(202, cobrancaActionResultDTOSchema.parse(mapCobrancaActionResultToDTO({
    success: true,
    message: 'Estorno solicitado. Status será atualizado via webhook.',
    pending: true,
    correlationId: params.correlationId,
    refundValue: refundValue ?? params.paymentValue,
  })));
}

async function executeEventRefund(params: {
  contaId: string;
  userId: string;
  role?: string;
  id: string;
  body: CobrancaRefundInputDTO;
  correlationId: string;
  startedAt: number;
}) {
  const paymentLookup = await resolveCobrancaPaymentLookupForTenant(params.contaId, params.id);
  if (!paymentLookup || paymentLookup.entityType !== 'EVENT') return result(404, { error: 'Cobrança não encontrada', correlationId: params.correlationId });
  if (!paymentLookup.asaasPaymentId) return result(400, { error: 'Cobrança sem integração com a plataforma financeira', correlationId: params.correlationId });
  if (!isAsaasEnabled()) return result(503, { error: 'Integração financeira desabilitada', correlationId: params.correlationId });

  const asaasPayment = await readPaymentFullPreflight(paymentLookup.asaasPaymentId, { contaId: params.contaId });
  const effectiveStatus = getEffectiveAsaasStatus(asaasPayment);
  const policy = evaluatePaymentActionPolicy({
    entityType: 'COBRANCA',
    origin: 'EVENT',
    localStatus: paymentLookup.localStatus,
    asaasStatus: effectiveStatus,
    billingType: asaasPayment.billingType ?? paymentLookup.billingType,
    hasAsaasPaymentId: true,
    hasInvoiceUrl: Boolean(paymentLookup.invoiceUrl || asaasPayment.invoiceUrl),
    wasReceivedInCash: effectiveStatus === 'RECEIVED_IN_CASH',
    paymentValue: asaasPayment.value ?? paymentLookup.value ?? 0,
    refundedValue: paymentLookup.operational?.refundedAmount ?? 0,
  });
  if (!policy.canRefund) return policyFailure(policy, effectiveStatus, params.correlationId, false);

  const operationalKind = paymentLookup.operational?.kind;
  if (params.body.value !== undefined && operationalKind === 'event-map-order') {
    return result(400, { error: 'Estorno parcial de pedido com assentos ainda não é permitido.', correlationId: params.correlationId, code: 'EVENT_SEATED_ORDER_PARTIAL_REFUND_NOT_SUPPORTED', hint: 'Para liberar assentos com segurança, solicite o estorno total da cobrança. Estorno parcial exige escolher quais ingressos/assentos serão cancelados.' });
  }
  if (params.body.value !== undefined && operationalKind === 'event-ticket-sale') {
    return result(400, { error: 'Estorno parcial de venda de ingresso não é permitido.', correlationId: params.correlationId, code: 'EVENT_TICKET_SALE_PARTIAL_REFUND_NOT_SUPPORTED', hint: 'Solicite o estorno total da venda para manter ingressos, lote e lançamento financeiro consistentes.' });
  }
  if (params.body.value !== undefined && !policy.canPartialRefund) return policyFailure(policy, effectiveStatus, params.correlationId, true);
  const paymentValue = asaasPayment.value ?? paymentLookup.value ?? 0;
  const invalidValue = validateRefundValue({ value: params.body.value, paymentValue, correlationId: params.correlationId, event: true });
  if (invalidValue) return invalidValue;

  return executeRefundCommand({
    ...params,
    asaasPayment,
    effectiveAsaasStatus: effectiveStatus,
    paymentValue,
    entityType: 'CHARGE',
    entityId: params.id,
    origin: 'EVENT',
  });
}

export async function executeCobrancaRefund(params: {
  contaId: string;
  userId: string;
  role?: string;
  id: string;
  body: CobrancaRefundInputDTO;
}): Promise<RefundCommandResult> {
  const correlationId = randomUUID();
  const startedAt = Date.now();
  try {
    const records = await loadCobrancaActionRecords(params.contaId, params.id);
    if (!records.cobranca && !records.charge) return executeEventRefund({ ...params, correlationId, startedAt });

    const asaasPaymentId = records.cobranca?.asaasPaymentId ?? records.charge?.asaasPaymentId ?? null;
    if (!asaasPaymentId) return result(400, { error: 'Cobrança sem integração com a plataforma financeira', correlationId });
    if (!isAsaasEnabled()) return result(503, { error: 'Integração financeira desabilitada', correlationId });

    const asaasPayment = await readPaymentFullPreflight(asaasPaymentId, { contaId: params.contaId });
    const effectiveStatus = getEffectiveAsaasStatus(asaasPayment);
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
      billingType: asaasPayment.billingType ?? records.charge?.billingType ?? null,
      hasAsaasPaymentId: true,
      hasInvoiceUrl: Boolean(records.cobranca?.charge?.invoiceUrl || records.charge?.invoiceUrl || asaasPayment.invoiceUrl),
      wasReceivedInCash: effectiveStatus === 'RECEIVED_IN_CASH',
      isInstallmentPayment: records.cobranca?.tipo === 'PARCELADA' || Boolean(records.charge?.standaloneInstallmentPlanId),
      isSubscriptionPayment: records.cobranca?.tipo === 'RECORRENTE' || Boolean(records.charge?.standaloneSubscriptionId),
      paymentValue: asaasPayment.value ?? Number(records.cobranca?.valor ?? records.charge?.value ?? 0),
      refundedValue: Array.isArray((asaasPayment as { refunds?: Array<{ value?: number; status?: string }> }).refunds)
        ? (asaasPayment as unknown as { refunds: Array<{ value?: number; status?: string }> }).refunds.filter((refund) => refund.status !== 'CANCELLED').reduce((sum, refund) => sum + Number(refund.value ?? 0), 0)
        : Number(records.cobranca?.estornadoValor ?? 0),
    });
    if (!policy.canRefund) return policyFailure(policy, effectiveStatus, correlationId, false);
    if (params.body.value !== undefined && !policy.canPartialRefund) return policyFailure(policy, effectiveStatus, correlationId, true);

    const paymentValue = asaasPayment.value ?? Number(records.cobranca?.valor ?? records.charge?.value ?? 0);
    const invalidValue = validateRefundValue({ value: params.body.value, paymentValue, correlationId, event: false });
    if (invalidValue) return invalidValue;

    return executeRefundCommand({
      ...params,
      correlationId,
      startedAt,
      asaasPayment,
      effectiveAsaasStatus: effectiveStatus,
      paymentValue,
      entityType: records.cobranca ? 'COBRANCA' : 'CHARGE',
      entityId: records.cobranca?.id ?? records.charge!.id,
      chargeId: records.charge?.id ?? null,
      cobrancaId: records.cobranca?.id ?? null,
      financialLog: true,
    });
  } catch (error) {
    console.error('[Refund] Erro:', error);
    if (error instanceof KycNotApprovedError) {
      return result(409, { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras', correlationId });
    }
    if (error instanceof AsaasHttpError && error.status >= 400 && error.status < 500) {
      return result(error.status, {
        error: 'Operação de estorno rejeitada pela plataforma financeira',
        message: 'A plataforma financeira rejeitou a solicitação de estorno.',
        correlationId,
      });
    }
    return result(500, {
      error: 'Erro ao estornar cobrança',
      message: 'Não foi possível processar o estorno agora.',
      correlationId,
    });
  }
}
