import { prisma } from '@alusa/database';
import type { PaymentStatus } from '@alusa/asaas';
import {
  refundTicketSalesByAsaasPayment,
} from '@alusa/lib';
import {
  cancelPublicEventMapOrderByPayment,
  confirmPublicEventMapOrderPayment,
  markPublicEventMapOrderRefundProcessingByPayment,
  reconcileEventMapOrderFinancialStateFromAsaas,
  refundPublicEventMapOrderByPayment,
  syncPublicEventMapOrderPaymentCreated,
} from '@alusa/lib/events/map/event-map.service';
import { isPaymentResolutionPolicyEnabled } from '../foundation/payment-resolution-policy';
import { resolvePaymentToLocalEntity } from './payment-resolver';
import {
  getCobrancaPrecedence,
  resolveInternalPaymentStatus,
} from '../mappers/status-precedence';
import { resolveLiquidacaoFromAsaasPayment } from '../mappers/liquidacao-from-asaas';
import { publishFinanceEvent } from '../realtime/finance-realtime-publisher';
import { buildPaymentExternalReference, mapAsaasToChargeStatus } from '../core';
import { ensureAcademicChargeForCobranca } from '../fiscal/ensure-academic-charge-for-cobranca';
import { auditLogService } from '../foundation/audit-log.service';
import { findStandaloneSubscription } from '../foundation/standalone-subscription-store';
import { chargeReadModelService } from '../read-model/charge-read-model.service';
import { financeSummaryReadModelService } from '../read-model/finance-summary-read-model.service';
import { updateFinanceStatusFromPayment } from '../guards/finance-status-guard';
import { withSessionAdvisoryLock } from '../core/idempotency.service';
import { getPayment, isAsaasEnabled } from '../use-cases/asaas-ops';
import { confirmPaymentCommandsByProviderEvent } from '../use-cases/payment-command-ledger';
import { fulfillReservedSaleOnPayment } from '../use-cases/store-inventory';
import { handleChargeInvoicePaymentEvent } from '../use-cases/handle-charge-invoice-payment-event';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
import { Prisma } from '@prisma/client';
import type {
  ChargeStatus,
  LiquidacaoStatus,
  FormaPagamento,
  FormaPagamentoLancamento,
  StatusLancamento,
  TipoLancamento,
  OrigemLancamento,
  StatusFinanceiro,
  StatusCobranca,
} from '@prisma/client';
import { mapAsaasPaymentStatusToCobranca } from '../mappers/charge-status/asaas-to-internal';
import { resolveMonotonicAsaasPaymentStatus } from '../mappers/asaas-snapshot-monotonicity';
import { normalizeAsaasPaymentSnapshotStatus as normalizeAsaasPaymentSnapshotStatusInput } from '../mappers/asaas-payment-snapshot-status';
import {
  projectAcademicEnrollmentFeeState,
  projectFamilyEnrollmentFeeState,
} from '../projections/enrollment-fee-projection.service';
import {
  decideCobrancaPaymentTransition,
  decideChargePaymentTransition,
  type ChargeStateDecision,
  type PaymentStateSource,
} from '../state-machine/payment-state-machine';
import { recordPaymentStateTransition } from '../state-machine/payment-state-transition.service';

export type PaymentWebhookPayload = {
  event: string;
  eventId?: string | null;
  source?: PaymentStateSource;
  providerOccurredAt?: Date | null;
  payment: {
    id: string;
    status: PaymentStatus;
    value: number;
    netValue: number;
    originalValue?: number | null;
    externalReference?: string;
    /** ID da assinatura (para pagamentos recorrentes) */
    subscription?: string | null;
    /** ID do parcelamento (para pagamentos parcelados) */
    installment?: string | null;
    /** Número da parcela dentro do parcelamento */
    installmentNumber?: number | null;
    /** Data de vencimento */
    dueDate?: string | null;
    /** Data de pagamento no Asaas (presente em RECEIVED_IN_CASH) */
    paymentDate?: string | null;
    /** Data em que o cliente pagou o boleto */
    clientPaymentDate?: string | null;
    /** Data em que o crédito ficou disponível */
    creditDate?: string | null;
    /** Data estimada para crédito */
    estimatedCreditDate?: string | null;
    /** Forma de pagamento (ex: BOLETO, CREDIT_CARD, RECEIVED_IN_CASH) */
    billingType?: string | null;
    /** Descrição retornada pelo payment oficial */
    description?: string | null;
    /** Link oficial da fatura no Asaas */
    invoiceUrl?: string | null;
    /** Link oficial para download do boleto */
    bankSlipUrl?: string | null;
    /** Link oficial do comprovante/transação */
    transactionReceiptUrl?: string | null;
    /** Indica remoção lógica do payment no Asaas */
    deleted?: boolean | null;
  };
};

export type PaymentWebhookResult = {
  success: boolean;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  localEntityType?: 'Cobranca' | 'Charge' | 'Payment';
  localEntityId?: string;
  previousStatus?: string;
  nextStatus?: string;
};

const SENSITIVE_PAYMENT_EVENTS = new Set([
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  'PAYMENT_DUNNING_REQUESTED',
  'PAYMENT_DUNNING_RECEIVED',
  'PAYMENT_AWAITING_RISK_ANALYSIS',
  'PAYMENT_APPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_SPLIT_DIVERGENCE_BLOCK',
  'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED',
]);

async function resolveLocalCustomerPayerName(
  contaId: string,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, contaId },
    select: { payerType: true, payerId: true },
  });

  if (!customer) return null;

  if (customer.payerType === 'ALUNO') {
    const aluno = await prisma.aluno.findFirst({
      where: { id: customer.payerId, contaId },
      select: { nome: true },
    });
    return aluno?.nome ?? null;
  }

  const responsavel = await prisma.responsavel.findFirst({
    where: { id: customer.payerId, contaId },
    select: { nome: true },
  });
  return responsavel?.nome ?? null;
}

function buildSensitivePaymentAuditMetadata(params: {
  event: string;
  internalStatus: string;
  currentStatus: string;
  nextStatus: string;
  payment: PaymentWebhookPayload['payment'];
}) {
  if (!SENSITIVE_PAYMENT_EVENTS.has(params.event)) return null;

  return {
    event: params.event,
    asaasPaymentId: params.payment.id,
    asaasStatus: params.payment.status,
    currentStatus: params.currentStatus,
    nextStatus: params.nextStatus,
    internalStatus: params.internalStatus,
    billingType: params.payment.billingType ?? null,
    value: params.payment.value,
    netValue: params.payment.netValue,
    originalValue: params.payment.originalValue ?? null,
    category:
      params.event === 'PAYMENT_PARTIALLY_REFUNDED'
        ? 'PARTIAL_REFUND'
        : params.event.includes('CHARGEBACK')
          ? 'CHARGEBACK'
          : params.event.includes('DUNNING')
            ? 'DUNNING'
            : params.event.includes('RISK_ANALYSIS') || params.event === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
              ? 'RISK'
              : params.event.includes('SPLIT')
                ? 'SPLIT'
                : 'REFUND',
  };
}

function buildCobrancaSensitiveUpdate(params: {
  event: string;
  internalStatus: string;
  occurredAt: Date;
}): Record<string, unknown> {
  if (params.event === 'PAYMENT_PARTIALLY_REFUNDED') {
    return {
      estornadoEm: params.occurredAt,
      estornadoMotivo: 'Webhook Asaas: estorno parcial',
      estornadoPor: 'ASAAS_WEBHOOK',
    };
  }

  if (params.internalStatus === 'REFUNDED') {
    return {
      estornadoEm: params.occurredAt,
      estornadoMotivo: `Webhook Asaas: ${params.event}`,
      estornadoPor: 'ASAAS_WEBHOOK',
    };
  }

  if (params.internalStatus === 'CHARGEBACK') {
    return {
      estornadoEm: params.occurredAt,
      estornadoMotivo: `Webhook Asaas: ${params.event}`,
      estornadoPor: 'ASAAS_WEBHOOK',
    };
  }

  return {};
}

function mapFormaPagamentoToLancamento(
  formaPagamento?: FormaPagamento | null
): FormaPagamentoLancamento {
  switch (formaPagamento) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'CARTAO_CREDITO':
      return 'CARTAO_CREDITO';
    case 'INDEFINIDO':
    default:
      return 'OUTRO';
  }
}

function mapBillingTypeToFormaPagamento(billingType: string): FormaPagamento | null {
  const normalized = billingType.trim().toUpperCase();
  switch (normalized) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'CREDIT_CARD':
      return 'CARTAO_CREDITO';
    default:
      return null;
  }
}

type LedgerPrismaClient =
  | Pick<typeof prisma, 'lancamento'>
  | Pick<Prisma.TransactionClient, 'lancamento'>;

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002',
  );
}

/**
 * Cria efeitos do ledger com a constraint como árbitro final da corrida.
 * O primeiro check evita round-trip desnecessário; o P2002 cobre dois
 * workers que atravessam o check simultaneamente.
 */
async function createLedgerEntryIdempotently(
  client: LedgerPrismaClient,
  data: Prisma.LancamentoUncheckedCreateInput,
) {
  try {
    return await client.lancamento.create({ data });
  } catch (error) {
    if (!isUniqueConstraintError(error) || !data.idempotencyKey) throw error;

    const existing = await client.lancamento.findUnique({
      where: {
        uq_lancamento_conta_idempotency: {
          contaId: data.contaId,
          idempotencyKey: data.idempotencyKey,
        },
      },
      select: { id: true },
    });
    if (existing) return existing;
    throw error;
  }
}

function resolveChargeInvoiceUrlUpdate(invoiceUrl?: string | null): string | undefined {
  if (typeof invoiceUrl !== 'string') return undefined;

  const normalized = invoiceUrl.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function hasOfficialAccessLink(payment: PaymentWebhookPayload['payment']): boolean {
  return Boolean(
    resolveChargeInvoiceUrlUpdate(payment.invoiceUrl) ||
      resolveChargeInvoiceUrlUpdate(payment.bankSlipUrl),
  );
}

async function enrichPaymentWithOfficialLinks(
  contaId: string,
  payment: PaymentWebhookPayload['payment'],
): Promise<PaymentWebhookPayload['payment']> {
  if (!isAsaasEnabled() || hasOfficialAccessLink(payment)) {
    return payment;
  }

  try {
    const officialPayment = await getPayment(payment.id, { contaId });
    return {
      ...payment,
      invoiceUrl: payment.invoiceUrl ?? officialPayment.invoiceUrl ?? null,
      bankSlipUrl: payment.bankSlipUrl ?? officialPayment.bankSlipUrl ?? null,
      transactionReceiptUrl: payment.transactionReceiptUrl ?? officialPayment.transactionReceiptUrl ?? null,
      billingType: payment.billingType ?? officialPayment.billingType ?? null,
      description: payment.description ?? officialPayment.description ?? null,
      dueDate: payment.dueDate ?? officialPayment.dueDate ?? null,
      creditDate: payment.creditDate ?? officialPayment.creditDate ?? null,
      estimatedCreditDate: payment.estimatedCreditDate ?? officialPayment.estimatedCreditDate ?? null,
    };
  } catch (error) {
    console.warn('[Asaas Webhook] Falha ao enriquecer payment sem link oficial', {
      contaId,
      asaasPaymentId: payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return payment;
  }
}

function resolveChargeDueDateUpdate(dueDate?: string | null): Date | undefined {
  if (!dueDate) return undefined;

  const parsed = new Date(dueDate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function resolveMatriculaFinanceStatusForCharge(params: {
  chargeType: string;
  nextChargeStatus: string;
}): StatusFinanceiro | null {
  if (params.chargeType !== 'TAXA_MATRICULA') return null;

  if (params.nextChargeStatus === 'PAGO') return 'ADIMPLENTE';
  if (params.nextChargeStatus === 'ATRASADO') return 'INADIMPLENTE';

  return null;
}

async function refreshReadModel(params: {
  chargeId?: string | null;
  cobrancaId?: string | null;
  contaId?: string | null;
}): Promise<void> {
  try {
    let contaId = params.contaId ?? null;
    if (params.chargeId) {
      await chargeReadModelService.projectChargeReadModelByChargeId(params.chargeId);
      if (!contaId && process.env.FIN_SUMMARY_READMODEL_ENABLED === 'true') {
        const charge = await prisma.charge.findUnique({
          where: { id: params.chargeId },
          select: { contaId: true },
        });
        contaId = charge?.contaId ?? null;
      }
    }
    if (params.cobrancaId) {
      await chargeReadModelService.projectChargeReadModelByCobrancaId(params.cobrancaId);
      if (!contaId && process.env.FIN_SUMMARY_READMODEL_ENABLED === 'true') {
        const cobranca = await prisma.cobranca.findUnique({
          where: { id: params.cobrancaId },
          select: { contaId: true },
        });
        contaId = cobranca?.contaId ?? null;
      }
    }
    if (contaId && process.env.FIN_SUMMARY_READMODEL_ENABLED === 'true') {
      const now = new Date();
      await financeSummaryReadModelService.refreshFinanceSummaryReadModel({
        contaId,
        window: {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
        },
        now,
      });
    }
  } catch (error) {
    console.warn('[payment-webhook] falha ao atualizar read model', {
      chargeId: params.chargeId ?? null,
      cobrancaId: params.cobrancaId ?? null,
      contaId: params.contaId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function computeLiquidacaoStatusFromPayload(payload: PaymentWebhookPayload): LiquidacaoStatus {
  const effectiveAsaasStatus = normalizeAsaasPaymentSnapshotStatus(payload) ?? payload.payment.status;
  return resolveLiquidacaoFromAsaasPayment({
    asaasStatus: effectiveAsaasStatus,
    creditDate: payload.payment.creditDate,
    billingType: payload.payment.billingType,
  });
}

function normalizeAsaasPaymentSnapshotStatus(payload: PaymentWebhookPayload): string | null {
  return normalizeAsaasPaymentSnapshotStatusInput({
    eventName: payload.event,
    status: payload.payment.status,
    billingType: payload.payment.billingType,
    deleted: payload.payment.deleted,
  });
}

async function publishPaymentRealtimeUpdate(params: {
  contaId: string;
  entityId: string;
  payload: PaymentWebhookPayload;
  dueDate?: Date | null;
}): Promise<void> {
  const p = params.payload.payment;
  const effectiveAsaasStatus = normalizeAsaasPaymentSnapshotStatus(params.payload) ?? 'PENDING';
  const dueDate =
    params.dueDate ??
    (typeof p.dueDate === 'string' ? new Date(`${p.dueDate}T12:00:00.000Z`) : null);

  try {
    await publishFinanceEvent({
      contaId: params.contaId,
      type: 'cobranca.updated',
      entityId: params.entityId,
      asaasPaymentId: p.id,
      status: mapAsaasPaymentStatusToCobranca(
        effectiveAsaasStatus,
        { dueDate },
      ) as StatusCobranca,
      liquidacaoStatus: computeLiquidacaoStatusFromPayload(params.payload),
      asaasStatus: effectiveAsaasStatus,
      revision: Date.now(),
    });
  } catch (error) {
    console.warn('[payment-webhook] Falha ao publicar evento realtime', {
      entityId: params.entityId,
      asaasPaymentId: p.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildChargeAsaasSnapshotUpdate(
  payload: PaymentWebhookPayload,
  context?: {
    currentAsaasStatus?: string | null;
    localChargeStatus?: ChargeStatus | string | null;
    localCobrancaStatus?: StatusCobranca | string | null;
  },
): Record<string, unknown> {
  const p = payload.payment;
  const liquidacaoStatus = computeLiquidacaoStatusFromPayload(payload);
  const incomingAsaasStatus = normalizeAsaasPaymentSnapshotStatus(payload);
  const providerStatus = resolveMonotonicAsaasPaymentStatus({
    currentAsaasStatus: context?.currentAsaasStatus,
    incoming: incomingAsaasStatus,
    localChargeStatus: context?.localChargeStatus,
    localCobrancaStatus: context?.localCobrancaStatus,
  });

  return {
    asaasStatus: providerStatus,
    providerStatus,
    asaasValue: p.value,
    asaasNetValue: p.netValue,
    asaasOriginalValue: p.originalValue ?? null,
    asaasFeeValue: p.value - p.netValue,
    asaasCreditDate: p.creditDate ? new Date(p.creditDate) : null,
    asaasEstimatedCreditDate: p.estimatedCreditDate ? new Date(p.estimatedCreditDate) : null,
    lastAsaasFetchAt: new Date(),
    liquidacaoStatus,
    liquidadoEm:
      liquidacaoStatus === 'DISPONIVEL'
        ? new Date(p.creditDate ?? p.paymentDate ?? p.clientPaymentDate ?? Date.now())
        : null,
  };
}

function buildPaymentStateDimensionUpdate(params: {
  payload: PaymentWebhookPayload;
  decision: { kind: string };
  now: Date;
}): Record<string, unknown> {
  const source = params.payload.source ?? 'WEBHOOK';
  const isApply = params.decision.kind === 'APPLY';
  const isReconcile = params.decision.kind === 'RECONCILE';

  return {
    processingStatus: 'PROCESSED',
    reconciliationStatus: isReconcile ? 'DIVERGENT' : 'IN_SYNC',
    providerUpdatedAt: params.payload.providerOccurredAt ?? params.now,
    ...(source === 'WEBHOOK'
      ? { lastWebhookAt: params.now }
      : { lastProviderCheckAt: params.now, lastReconciledAt: params.now }),
    ...(params.payload.eventId && isApply ? { lastAppliedEventId: params.payload.eventId } : {}),
    ...(isApply ? { localStateUpdatedAt: params.now, version: { increment: 1 } } : {}),
  };
}

function resolveCobrancaAsaasStatusFromPayload(
  payload: PaymentWebhookPayload,
  context: {
    currentAsaasStatus?: string | null;
    localCobrancaStatus: StatusCobranca | string;
    localChargeStatus?: ChargeStatus | string | null;
  },
): string | null {
  const incomingAsaasStatus = normalizeAsaasPaymentSnapshotStatus(payload);

  return resolveMonotonicAsaasPaymentStatus({
    currentAsaasStatus: context.currentAsaasStatus,
    incoming: incomingAsaasStatus,
    localChargeStatus: context.localChargeStatus,
    localCobrancaStatus: context.localCobrancaStatus,
  });
}

type CobrancaSelect = {
  id: true;
  matriculaId: true;
  status: true;
  asaasPaymentId: true;
  asaasStatus: true;
  providerStatus: true;
  version: true;
  tipo: true;
  formaPagamento: true;
};

const COBRANCA_SELECT: CobrancaSelect = {
  id: true,
  matriculaId: true,
  status: true,
  asaasPaymentId: true,
  asaasStatus: true,
  providerStatus: true,
  version: true,
  tipo: true,
  formaPagamento: true,
};

/**
 * Upsert atômico de Cobranca por asaasPaymentId (unique).
 * Se já existir → retorna existente (sem duplicar).
 * Se não → cria e retorna.
 * Usa try/catch com P2002 como safety net para race conditions.
 */
async function upsertCobrancaByAsaasPaymentId(params: {
  contaId: string;
  asaasPaymentId: string;
  matriculaId: string;
  tipo: 'MENSALIDADE' | 'PARCELADA';
  valor: number;
  vencimento: Date;
  descricao: string;
  asaasStatus: string;
  asaasNetValue: number;
  formaPagamento?: FormaPagamento | null;
}) {
  // Tentar encontrar existente primeiro (fast path)
  const existing = await prisma.cobranca.findUnique({
    where: {
      uq_cobranca_conta_asaas_payment: {
        contaId: params.contaId,
        asaasPaymentId: params.asaasPaymentId,
      },
    },
    select: COBRANCA_SELECT,
  });
  if (existing) {
    if (
      params.formaPagamento &&
      params.formaPagamento !== 'INDEFINIDO' &&
      existing.formaPagamento === 'INDEFINIDO'
    ) {
      const updated = await prisma.cobranca.update({
        where: { id: existing.id },
        data: { formaPagamento: params.formaPagamento },
        select: COBRANCA_SELECT,
      });
      return { cobranca: updated, created: false };
    }

    return { cobranca: existing, created: false };
  }

  const competenciaInicio = new Date(params.vencimento.getFullYear(), params.vencimento.getMonth(), 1);
  const competenciaFim = new Date(params.vencimento.getFullYear(), params.vencimento.getMonth() + 1, 0);

  try {
    const cobranca = await prisma.cobranca.create({
      data: {
        contaId: params.contaId,
        matriculaId: params.matriculaId,
        tipo: params.tipo,
        valor: params.valor,
        vencimento: params.vencimento,
        status: 'PENDENTE',
        descricao: params.descricao,
        competenciaInicio,
        competenciaFim,
        asaasPaymentId: params.asaasPaymentId,
        asaasStatus: params.asaasStatus,
        providerStatus: params.asaasStatus,
        asaasValue: params.valor,
        asaasNetValue: params.asaasNetValue,
        formaPagamento: params.formaPagamento ?? 'INDEFINIDO',
      },
      select: COBRANCA_SELECT,
    });
    return { cobranca, created: true };
  } catch (error: unknown) {
    // P2002 = unique constraint violation → outro processo já criou
    if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
      const fallback = await prisma.cobranca.findUnique({
        where: {
          uq_cobranca_conta_asaas_payment: {
            contaId: params.contaId,
            asaasPaymentId: params.asaasPaymentId,
          },
        },
        select: COBRANCA_SELECT,
      });
      if (fallback) return { cobranca: fallback, created: false };
    }
    throw error;
  }
}

/**
 * Side effect fiscal idempotente — emissão/cancelamento de NFS-e conforme evento de pagamento.
 */
async function applyChargeInvoicePaymentSideEffect(params: {
  contaId: string;
  chargeId: string;
  asaasPaymentId: string;
  event: string;
  providerStatus?: string | null;
  asaasPaymentSubscription?: string | null;
}) {
  try {
    await handleChargeInvoicePaymentEvent({
      contaId: params.contaId,
      chargeId: params.chargeId,
      asaasPaymentId: params.asaasPaymentId,
      event: params.event,
      providerStatus: params.providerStatus,
      asaasPaymentSubscription: params.asaasPaymentSubscription,
    });
  } catch (invoiceSideEffectError) {
    console.error('[payment-webhook] Falha ao aplicar side effect fiscal:', {
      chargeId: params.chargeId,
      contaId: params.contaId,
      event: params.event,
      error:
        invoiceSideEffectError instanceof Error
          ? invoiceSideEffectError.message
          : String(invoiceSideEffectError),
    });
  }
}

/**
 * Processa webhook para cobranças standalone (sem matrícula)
 * Atualiza apenas a entidade Charge
 */
async function handleStandaloneChargeWebhook(
  contaId: string,
  payload: PaymentWebhookPayload,
  charge: {
    id: string;
    status: ChargeStatus;
    asaasPaymentId: string | null;
    asaasStatus?: string | null;
    providerStatus?: string | null;
  }
): Promise<PaymentWebhookResult> {
  const p = payload.payment;
  const standaloneParentReference = p.externalReference?.match(
    /^(alusa:standalone-subscription:[^:]+):/,
  )?.[1] ?? p.externalReference;
  const linkedStandaloneSubscription =
    (p.subscription
      ? await findStandaloneSubscription(prisma, {
          contaId,
          asaasSubscriptionId: p.subscription,
        })
      : null) ??
    (standaloneParentReference?.startsWith('alusa:standalone-subscription:')
      ? await findStandaloneSubscription(prisma, {
          contaId,
          externalReference: standaloneParentReference,
        })
      : null);
  const standaloneLinkData = linkedStandaloneSubscription
    ? {
        standaloneSubscriptionId: linkedStandaloneSubscription.id,
        externalReference: buildPaymentExternalReference(
          linkedStandaloneSubscription.externalReference,
          p.id,
        ),
        customerId: linkedStandaloneSubscription.customerId,
        familyGroupId: linkedStandaloneSubscription.familyGroupId,
      }
    : {};
  const effectiveAsaasStatus = normalizeAsaasPaymentSnapshotStatus(payload) ?? p.status;
  const internalStatus = resolveInternalPaymentStatus({
    eventName: payload.event,
    asaasPaymentStatus: effectiveAsaasStatus,
    billingType: p.billingType ?? null,
    deleted: p.deleted ?? null,
  });

  const stateDecision = decideChargePaymentTransition({
    currentLocalStatus: charge.status,
    currentProviderStatus: charge.providerStatus ?? charge.asaasStatus,
    incomingProviderStatus: effectiveAsaasStatus,
    internalStatus,
    eventName: payload.event,
    source: payload.source ?? 'WEBHOOK',
  });
  const nextStatusCharge = stateDecision.nextLocalStatus;
  // Mantém o contrato de resposta legado: o status tentado pelo evento pode
  // ser reportado mesmo quando a máquina decide não aplicá-lo localmente.
  const attemptedStatusCharge =
    stateDecision.kind !== 'APPLY' && internalStatus === 'OVERDUE'
      ? 'OVERDUE'
      : nextStatusCharge;
  const stateDimensionUpdate = buildPaymentStateDimensionUpdate({
    payload,
    decision: stateDecision,
    now: new Date(),
  });
  if (stateDecision.kind !== 'APPLY' && charge.status !== attemptedStatusCharge) {
    console.warn('⚠️ Regressão de status bloqueada (standalone charge):', {
      chargeId: charge.id,
      currentStatus: charge.status,
      attemptedStatus: attemptedStatusCharge,
      event: payload.event,
      deleted: payload.payment.deleted ?? null,
    });
    await prisma.charge.update({
      where: { id: charge.id },
      data: {
        statusUpdatedAt: new Date(),
        ...standaloneLinkData,
        ...buildChargeAsaasSnapshotUpdate(payload, {
          currentAsaasStatus: charge.providerStatus ?? charge.asaasStatus,
          localChargeStatus: charge.status,
        }),
        ...stateDimensionUpdate,
        ...(charge.asaasPaymentId ? {} : { asaasPaymentId: p.id }),
      },
    });
    await refreshReadModel({ chargeId: charge.id });
    await applyChargeInvoicePaymentSideEffect({
      contaId,
      chargeId: charge.id,
      asaasPaymentId: p.id,
      event: payload.event,
      providerStatus: p.status,
      asaasPaymentSubscription: p.subscription,
    });
    await projectFamilyEnrollmentFeeState({
      contaId,
      chargeId: charge.id,
      eventName: payload.event,
    });
    await auditLogService.record({
      contaId,
      action: 'finance.webhook.standalone_charge_skipped',
      entity: { type: 'Charge', id: charge.id },
      metadata: {
        event: payload.event,
        asaasPaymentId: p.id,
        asaasStatus: effectiveAsaasStatus,
        billingType: p.billingType ?? null,
        previousStatus: charge.status,
        attemptedStatus: attemptedStatusCharge,
        skipReason: 'STATUS_TRANSITION_BLOCKED',
        snapshotPersisted: true,
      },
    });
    await recordPaymentStateTransition({
      contaId,
      entityType: 'CHARGE',
      entityId: charge.id,
      source: payload.source ?? 'WEBHOOK',
      sourceId: payload.eventId ?? `payment:${p.id}:${payload.event}`,
      decision: stateDecision,
      providerOccurredAt: payload.providerOccurredAt ?? null,
      metadata: { asaasPaymentId: p.id },
    });
    return {
      success: true,
      skipped: true,
      skipReason: 'STATUS_TRANSITION_BLOCKED',
      localEntityType: 'Charge',
      localEntityId: charge.id,
      previousStatus: charge.status,
      nextStatus: attemptedStatusCharge,
    };
  }

  // Atualizar Charge
  const updateData: Record<string, unknown> = {
    status: nextStatusCharge,
    statusUpdatedAt: new Date(),
    value: p.value,
    ...standaloneLinkData,
    ...buildChargeAsaasSnapshotUpdate(payload, {
      currentAsaasStatus: charge.providerStatus ?? charge.asaasStatus,
      localChargeStatus: charge.status,
    }),
    ...stateDimensionUpdate,
  };

  const dueDateUpdate = resolveChargeDueDateUpdate(p.dueDate);
  if (dueDateUpdate) {
    updateData.dueDate = dueDateUpdate;
  }

  if (typeof p.billingType === 'string' && p.billingType.trim().length > 0) {
    updateData.billingType = p.billingType;
  }

  if (typeof p.description === 'string') {
    updateData.description = p.description;
  }

  const invoiceUrlUpdate = resolveChargeInvoiceUrlUpdate(p.invoiceUrl);
  if (invoiceUrlUpdate) {
    updateData.invoiceUrl = invoiceUrlUpdate;
  }

  if (!charge.asaasPaymentId) {
    updateData.asaasPaymentId = p.id;
  }

  await prisma.charge.update({
    where: { id: charge.id },
    data: updateData,
  });

  await refreshReadModel({ chargeId: charge.id });

  // Cumprir reserva de estoque automaticamente quando pagamento é confirmado
  if (nextStatusCharge === 'PAID') {
    try {
      await fulfillReservedSaleOnPayment({ contaId, chargeId: charge.id });
    } catch (fulfillError) {
      // Não falhar o webhook por erro de fulfillment — logar e seguir
      console.error('[handleStandaloneChargeWebhook] Erro ao cumprir reserva de estoque:', {
        chargeId: charge.id,
        contaId,
        error: fulfillError instanceof Error ? fulfillError.message : String(fulfillError),
      });
    }
  }

  await applyChargeInvoicePaymentSideEffect({
    contaId,
    chargeId: charge.id,
    asaasPaymentId: p.id,
    event: payload.event,
    providerStatus: p.status,
    asaasPaymentSubscription: p.subscription,
  });
  await projectFamilyEnrollmentFeeState({
    contaId,
    chargeId: charge.id,
    eventName: payload.event,
  });

  await auditLogService.record({
    contaId,
    action: 'finance.webhook.standalone_charge_updated',
    entity: { type: 'Charge', id: charge.id },
    metadata: {
      event: payload.event,
      asaasPaymentId: p.id,
      previousStatus: charge.status,
      newStatus: nextStatusCharge,
      value: p.value,
      netValue: p.netValue,
    },
  });

  await recordPaymentStateTransition({
    contaId,
    entityType: 'CHARGE',
    entityId: charge.id,
    source: payload.source ?? 'WEBHOOK',
    sourceId: payload.eventId ?? `payment:${p.id}:${payload.event}`,
    decision: stateDecision,
    providerOccurredAt: payload.providerOccurredAt ?? null,
    metadata: { asaasPaymentId: p.id },
  });

  console.log('✅ Standalone charge atualizada via webhook:', {
    chargeId: charge.id,
    status: nextStatusCharge,
    asaasPaymentId: p.id,
  });

  await publishPaymentRealtimeUpdate({
    contaId,
    entityId: charge.id,
    payload,
    dueDate: dueDateUpdate ?? null,
  });

  try {
    await updateEventFinancialEntryFromWebhook(contaId, payload);
  } catch (err) {
    console.error('[handleStandaloneChargeWebhook] Falha ao sincronizar EventFinancialEntry:', err);
  }

  return { success: true };
}

async function updateEventFinancialEntryFromWebhook(
  contaId: string,
  payload: PaymentWebhookPayload,
): Promise<void> {
  if (!prisma.eventFinancialEntry) return;
  const p = payload.payment;
  const effectiveAsaasStatus = normalizeAsaasPaymentSnapshotStatus(payload) ?? p.status;
  const paymentId = p.id;
  const installmentId = p.installment ?? null;
  const subscriptionId = p.subscription ?? null;

  const entry = await prisma.eventFinancialEntry.findFirst({
    where: {
      contaId,
      OR: [
        { asaasPaymentId: paymentId },
        ...(installmentId ? [{ asaasPaymentId: installmentId }] : []),
        ...(subscriptionId ? [{ asaasPaymentId: subscriptionId }] : []),
      ],
    },
    select: { id: true, expectedAmount: true },
  });

  if (!entry) return;

  // Let's load all charges for this plan/payment to compute dynamic values
  let charges: any[] = [];
  if (installmentId) {
    const plan = await prisma.standaloneInstallmentPlan.findFirst({
      where: { contaId, asaasInstallmentId: installmentId },
      include: { charges: true },
    });
    if (plan) {
      charges = plan.charges;
    }
  }

  if (charges.length === 0) {
    const directCharge = await prisma.charge.findFirst({
      where: { contaId, asaasPaymentId: paymentId },
    });
    if (directCharge) {
      if (directCharge.standaloneInstallmentPlanId) {
        charges = await prisma.charge.findMany({
          where: { contaId, standaloneInstallmentPlanId: directCharge.standaloneInstallmentPlanId },
        });
      } else {
        charges = [directCharge];
      }
    }
  }

  // Fallback if charges aren't materialised yet or is a one-off payment
  if (charges.length === 0) {
    charges = [{
      status: effectiveAsaasStatus,
      value: p.value,
      billingType: p.billingType,
    }];
  }

  const paidStatus = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED', 'PAID'];
  const refundedStatus = ['REFUNDED', 'REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DEPOSITED'];
  const cancelledStatus = ['CANCELED', 'DELETED'];

  const paidCharges = charges.filter((c) => paidStatus.includes(c.status));
  const refundedCharges = charges.filter((c) => refundedStatus.includes(c.status));
  const cancelledCharges = charges.filter((c) => cancelledStatus.includes(c.status));

  const totalPaid = paidCharges.reduce((sum, c) => sum + (c.value ? Number(c.value) : 0), 0);
  const totalRefunded = refundedCharges.reduce((sum, c) => sum + (c.value ? Number(c.value) : 0), 0);

  let nextStatus: 'RECEIVED' | 'PENDING' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'CANCELLED' = 'PENDING';
  let realizedAt: Date | null = null;
  let cancelledAt: Date | null = null;
  let refundedAt: Date | null = null;

  if (cancelledCharges.length === charges.length) {
    nextStatus = 'CANCELLED';
    cancelledAt = new Date();
  } else if (payload.event === 'PAYMENT_PARTIALLY_REFUNDED') {
    nextStatus = 'PARTIALLY_REFUNDED';
    refundedAt = new Date();
  } else if (refundedCharges.length > 0 && (refundedCharges.length + cancelledCharges.length === charges.length)) {
    nextStatus = 'REFUNDED';
    refundedAt = new Date();
  } else if (paidCharges.length + cancelledCharges.length + refundedCharges.length === charges.length) {
    nextStatus = 'RECEIVED';
    const paymentDateStr = p.clientPaymentDate ?? p.paymentDate ?? p.creditDate;
    realizedAt = paymentDateStr ? new Date(paymentDateStr) : new Date();
  } else {
    nextStatus = 'PENDING';
    if (paidCharges.length > 0) {
      const paymentDateStr = p.clientPaymentDate ?? p.paymentDate ?? p.creditDate;
      realizedAt = paymentDateStr ? new Date(paymentDateStr) : new Date();
    }
  }

  const actualAmount = totalPaid > 0 ? totalPaid : null;
  const refundedAmount = payload.event === 'PAYMENT_PARTIALLY_REFUNDED'
    ? Math.min(Number(p.value ?? 0), totalPaid || Number(entry.expectedAmount))
    : totalRefunded;
  const netAmount = actualAmount == null ? null : Math.max(actualAmount - refundedAmount, 0);

  await prisma.eventFinancialEntry.update({
    where: { id: entry.id },
    data: {
      status: nextStatus as any,
      paymentStatus: effectiveAsaasStatus,
      actualAmount: actualAmount ? new Prisma.Decimal(actualAmount) : null,
      refundedAmount: new Prisma.Decimal(refundedAmount),
      netAmount: netAmount == null ? null : new Prisma.Decimal(netAmount),
      realizedAt,
      cancelledAt,
      refundedAt,
    },
  });

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      contaId,
      OR: [
        { revenueEntryId: entry.id },
        { asaasPaymentId: paymentId },
        ...(p.installment ? [{ asaasInstallmentId: p.installment }] : []),
      ],
    },
    select: { id: true },
  });

  if (participant) {
    await prisma.eventParticipant.update({
      where: { id: participant.id },
      data: {
        isFeePaid: nextStatus === 'RECEIVED',
        ...(nextStatus === 'RECEIVED' && p.billingType && { feePaymentMethod: p.billingType }),
      },
    });
  }
}

/**
 * Processa webhook de pagamento do Asaas
 * ADR-002: Webhook como fonte da verdade
 */
export async function handlePaymentWebhook(
  contaId: string,
  payload: PaymentWebhookPayload
): Promise<PaymentWebhookResult> {
  const paymentId = payload.payment?.id?.trim();
  if (!paymentId) {
    return { success: false, error: 'Payment ID ausente' };
  }

  return withSessionAdvisoryLock({
    contaId,
    scope: 'webhook-process',
    key: `payment:${paymentId}`,
    fn: () => handlePaymentWebhookCore(contaId, payload),
  });
}

async function handlePaymentWebhookCore(
  contaId: string,
  payload: PaymentWebhookPayload
): Promise<PaymentWebhookResult> {
  try {
    payload = {
      ...payload,
      payment: await enrichPaymentWithOfficialLinks(contaId, payload.payment),
    };
    const effectiveAsaasStatus = normalizeAsaasPaymentSnapshotStatus(payload) ?? payload.payment.status;

    try {
      await confirmPaymentCommandsByProviderEvent({
        contaId,
        asaasPaymentId: payload.payment.id,
        eventName: payload.event,
        providerStatus: payload.payment.status,
      });
    } catch (commandError) {
      console.warn('[payment-webhook] Falha não crítica ao confirmar comando financeiro pendente', {
        contaId,
        asaasPaymentId: payload.payment.id,
        event: payload.event,
        message: commandError instanceof Error ? commandError.message : String(commandError),
      });
    }

    try {
      const paidAt =
        payload.payment.clientPaymentDate ??
        payload.payment.paymentDate ??
        payload.payment.creditDate ??
        new Date().toISOString();
      if (
        ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_RECEIVED_IN_CASH', 'PAYMENT_DUNNING_RECEIVED'].includes(payload.event) ||
        ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'].includes(effectiveAsaasStatus)
      ) {
        const eventPaymentParams = {
          contaId,
          asaasPaymentId: payload.payment.id,
          externalReference: payload.payment.externalReference,
          paymentStatus: effectiveAsaasStatus,
          invoiceUrl: payload.payment.invoiceUrl ?? null,
          paidAt,
          paidAmount: payload.payment.value,
        };
        try {
          const confirmed = await confirmPublicEventMapOrderPayment(eventPaymentParams);
          if (!confirmed) {
            await reconcileEventMapOrderFinancialStateFromAsaas(eventPaymentParams);
          }
        } catch (confirmError) {
          console.warn('[payment-webhook] Confirmação completa do pedido público falhou; tentando reconciliação financeira', {
            contaId,
            asaasPaymentId: payload.payment.id,
            message: confirmError instanceof Error ? confirmError.message : String(confirmError),
          });
          await reconcileEventMapOrderFinancialStateFromAsaas(eventPaymentParams);
        }
      } else if (payload.event === 'PAYMENT_CREATED' || payload.payment.status === 'PENDING') {
        await syncPublicEventMapOrderPaymentCreated({
          contaId,
          asaasPaymentId: payload.payment.id,
          externalReference: payload.payment.externalReference,
          paymentStatus: effectiveAsaasStatus,
          invoiceUrl: payload.payment.invoiceUrl ?? null,
        });
      } else if (payload.event === 'PAYMENT_REFUNDED' || effectiveAsaasStatus === 'REFUNDED') {
        await refundPublicEventMapOrderByPayment({
          contaId,
          asaasPaymentId: payload.payment.id,
          externalReference: payload.payment.externalReference,
          refundedAmount: payload.payment.value,
        });
        await refundTicketSalesByAsaasPayment({
          contaId,
          asaasPaymentId: payload.payment.id,
          paymentStatus: effectiveAsaasStatus,
          isFinalRefund: true,
          refundedAmount: payload.payment.value,
        });
      } else if (payload.event === 'PAYMENT_PARTIALLY_REFUNDED') {
        await refundPublicEventMapOrderByPayment({
          contaId,
          asaasPaymentId: payload.payment.id,
          externalReference: payload.payment.externalReference,
          refundedAmount: payload.payment.value,
          partial: true,
        });
        await refundTicketSalesByAsaasPayment({
          contaId,
          asaasPaymentId: payload.payment.id,
          paymentStatus: effectiveAsaasStatus,
          isFinalRefund: false,
          refundedAmount: payload.payment.value,
        });
      } else if (payload.event === 'PAYMENT_REFUND_IN_PROGRESS' || payload.event === 'PAYMENT_REFUND_DENIED') {
        await markPublicEventMapOrderRefundProcessingByPayment({
          contaId,
          asaasPaymentId: payload.payment.id,
          externalReference: payload.payment.externalReference,
          paymentStatus: payload.event === 'PAYMENT_REFUND_DENIED' ? 'REFUND_DENIED' : payload.payment.status,
        });
        await refundTicketSalesByAsaasPayment({
          contaId,
          asaasPaymentId: payload.payment.id,
          paymentStatus: payload.event === 'PAYMENT_REFUND_DENIED' ? 'REFUND_DENIED' : payload.payment.status,
          isFinalRefund: false,
        });
      } else if (payload.event === 'PAYMENT_DELETED' || payload.payment.deleted) {
        await cancelPublicEventMapOrderByPayment({
          contaId,
          asaasPaymentId: payload.payment.id,
          externalReference: payload.payment.externalReference,
          reason: payload.event,
        });
      }
    } catch (eventOrderError) {
      console.error('[payment-webhook] Falha ao sincronizar pedido público de evento:', eventOrderError);
    }

    // A validação de origem/assinatura do webhook deve acontecer no handler principal
    // (com base no rawBody) para evitar recomputar HMAC em JSON reconstruído.

    // ─────────────────────────────────────────────────────────────────────────
    // Linkagem determinística oficial via resolver
    // ─────────────────────────────────────────────────────────────────────────
    if (isPaymentResolutionPolicyEnabled('payment.webhook_deterministic_resolution')) {
      const resolveResult = await resolvePaymentToLocalEntity({
        contaId,
        asaasPaymentId: payload.payment.id,
        externalReference: payload.payment.externalReference,
        asaasSubscriptionId: payload.payment.subscription,
        asaasInstallmentId: payload.payment.installment,
        dueDate: payload.payment.dueDate,
        installmentNumber: payload.payment.installmentNumber,
      });

      // Se resolver encontrou algo, processar de forma determinística
      if (resolveResult.type !== 'not_found') {
        console.log('[payment-webhook] resolver determinístico encontrou:', {
          contaId,
          asaasPaymentId: payload.payment.id,
          resolveType: resolveResult.type,
          resolveResult,
        });

        // Processar como standalone somente quando a Charge não é espelho de Cobranca acadêmica.
        if (resolveResult.type === 'charge' && resolveResult.chargeId && !resolveResult.cobrancaId) {
          const charge = await prisma.charge.findUnique({
            where: { id: resolveResult.chargeId },
            select: { id: true, status: true, asaasPaymentId: true, asaasStatus: true, providerStatus: true },
          });
          if (charge) {
            return handleStandaloneChargeWebhook(contaId, payload, charge);
          }
        }

        // Para cobranca, subscription, installmentPlan ou Charge acadêmica,
        // continuar com a lógica de Cobranca abaixo. Ela resolve pelo asaasPaymentId
        // e atualiza Cobranca + Charge espelho de forma consistente.
      } else {
        // Log para auditoria de fallback
        console.warn('[payment-webhook] resolver determinístico não encontrou, usando fallback compatível:', {
          contaId,
          asaasPaymentId: payload.payment.id,
          externalReference: payload.payment.externalReference,
          reason: resolveResult.reason,
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LÓGICA V1 (FALLBACK): Mantida para compatibilidade
    // ─────────────────────────────────────────────────────────────────────────

    // 1. Resolver cobrança (preferindo externalReference quando possível)
    const paymentExternalReference = payload.payment.externalReference;
    let subscriptionRecord: { id: string; externalReference: string } | null = null;
    
    // Suportar prefixos: 'charge:' (fluxo matrícula) e 'standalone:' (fluxo customer-first)
    const isChargeRef = paymentExternalReference?.startsWith('charge:');
    
    const externalRefId =
      paymentExternalReference && isChargeRef
        ? paymentExternalReference.slice('charge:'.length)
        : null;

    // Buscar Charge por externalReference (suporta ambos os prefixos)
    const chargeLookupOr = [
      ...(paymentExternalReference ? [{ externalReference: paymentExternalReference }] : []),
      ...(externalRefId ? [{ id: externalRefId }, { cobrancaId: externalRefId }] : []),
      { asaasPaymentId: payload.payment.id },
    ];

    const chargeFromExternalRef = await prisma.charge.findFirst({
      where: {
        contaId,
        OR: chargeLookupOr,
      },
      select: { id: true, cobrancaId: true, status: true, asaasPaymentId: true, asaasStatus: true, providerStatus: true },
    });

    // Para cobranças standalone (sem cobrancaId), processar apenas o Charge
    if (chargeFromExternalRef && !chargeFromExternalRef.cobrancaId) {
      return handleStandaloneChargeWebhook(contaId, payload, chargeFromExternalRef);
    }

    const cobrancaIdFromExternalRef = chargeFromExternalRef?.cobrancaId ?? null;

    // Construir queries de busca de cobrança
    const baseOrConditions = [
      ...(externalRefId ? [{ id: externalRefId }] : []),
      ...(cobrancaIdFromExternalRef ? [{ id: cobrancaIdFromExternalRef }] : []),
      { asaasPaymentId: payload.payment.id },
      { asaasId: payload.payment.id },
    ].filter(Boolean);

    let cobranca = await prisma.cobranca.findFirst({
      where: {
        AND: [
          { matricula: { aluno: { contaId } } },
          { OR: baseOrConditions },
        ],
      },
      select: {
        id: true,
        matriculaId: true,
        status: true,
        asaasPaymentId: true,
        asaasStatus: true,
        providerStatus: true,
        version: true,
        tipo: true,
        formaPagamento: true,
      },
    });

    // 1.1. Se não encontrou e o pagamento é de uma assinatura, buscar via asaasSubscriptionId
    if (!cobranca && payload.payment.subscription) {
      const subscriptionId = payload.payment.subscription;
      
      // Encontrar a matrícula via asaasSubscriptionId e buscar cobrança MENSALIDADE sem asaasPaymentId
      const matriculaFromSubscription = await prisma.matricula.findFirst({
        where: {
          aluno: { contaId },
          asaasSubscriptionId: subscriptionId,
        },
        select: { id: true },
      });

      if (matriculaFromSubscription) {
        // Buscar a cobrança de MENSALIDADE mais próxima do vencimento sem asaasPaymentId
        cobranca = await prisma.cobranca.findFirst({
          where: {
            matriculaId: matriculaFromSubscription.id,
            tipo: 'MENSALIDADE',
            asaasPaymentId: null,
            status: { in: ['PENDENTE', 'A_VENCER'] },
          },
          orderBy: { vencimento: 'asc' },
          select: {
            id: true,
            matriculaId: true,
            status: true,
            asaasPaymentId: true,
            asaasStatus: true,
            providerStatus: true,
            version: true,
            tipo: true,
            formaPagamento: true,
          },
        });

        if (cobranca) {
          // Atualizar a cobrança com o asaasPaymentId da assinatura
          await prisma.cobranca.update({
            where: { id: cobranca.id },
            data: { asaasPaymentId: payload.payment.id },
          });
          cobranca = {
            ...cobranca,
            asaasPaymentId: payload.payment.id,
          };
          console.log('✅ Cobrança MENSALIDADE vinculada ao pagamento da assinatura:', {
            cobrancaId: cobranca.id,
            asaasPaymentId: payload.payment.id,
            asaasSubscriptionId: subscriptionId,
          });
        }
      }
    }

    // 1.2 Se não encontrou cobrança e é de uma assinatura, criar cobrança automaticamente
    if (!cobranca && payload.payment.subscription) {
      const subscriptionId = payload.payment.subscription;
      
      // Buscar matrícula e subscription para obter dados necessários
      const subscription = await prisma.subscription.findFirst({
        where: {
          contaId,
          asaasSubscriptionId: subscriptionId,
        },
        select: {
          id: true,
          externalReference: true,
          matriculaId: true,
          matricula: {
            select: {
              id: true,
              alunoId: true,
              planoId: true,
              comboId: true,
              vencimentoDia: true,
              plano: { select: { id: true, nome: true, valor: true } },
              combo: { select: { id: true, nome: true, valor: true } },
            },
          },
        },
      });
      subscriptionRecord = subscription
        ? { id: subscription.id, externalReference: subscription.externalReference }
        : null;

      if (!subscription) {
        // Buscar na tabela StandaloneSubscription
        let standaloneSubRecord = await findStandaloneSubscription(prisma, {
          contaId,
          asaasSubscriptionId: subscriptionId,
        });

        // PAYMENT_CREATED pode chegar imediatamente após a criação remota,
        // antes de a transação local da assinatura terminar. Aguarde uma
        // janela curta e determinística antes de criar um placeholder sem
        // vínculo; o webhook continua sendo idempotente.
        if (!standaloneSubRecord) {
          for (const delayMs of [150, 400, 900]) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            standaloneSubRecord = await findStandaloneSubscription(prisma, {
              contaId,
              asaasSubscriptionId: subscriptionId,
            });
            if (standaloneSubRecord) break;
          }
        }

        if (standaloneSubRecord) {
          const payerNameFromCustomer =
            (await resolveLocalCustomerPayerName(contaId, standaloneSubRecord.customerId)) ??
            'Cliente';
          const externalRef = buildPaymentExternalReference(standaloneSubRecord.externalReference, payload.payment.id);
          const chargeStatus = mapAsaasToChargeStatus(effectiveAsaasStatus);
          const parsedDueDate = payload.payment.dueDate;
          const vencimento = parsedDueDate ? new Date(parsedDueDate) : new Date();

          const standaloneSubscriptionCharge = await prisma.charge.upsert({
            where: {
              uq_charge_conta_asaas_payment: {
                contaId,
                asaasPaymentId: payload.payment.id,
              },
            },
            update: {
              externalReference: externalRef,
              status: chargeStatus,
              statusUpdatedAt: new Date(),
              billingType: payload.payment.billingType ?? standaloneSubRecord.billingType,
              dueDate: vencimento,
              value: payload.payment.value,
              description: standaloneSubRecord.description ?? 'Assinatura recorrente',
              customerId: standaloneSubRecord.customerId,
              standaloneSubscriptionId: standaloneSubRecord.id,
              familyGroupId: standaloneSubRecord.familyGroupId,
              invoiceUrl: resolveChargeInvoiceUrlUpdate(payload.payment.invoiceUrl),
              ...buildChargeAsaasSnapshotUpdate(payload, { localChargeStatus: chargeStatus }),
            },
            create: {
              contaId,
              externalReference: externalRef,
              status: chargeStatus,
              statusUpdatedAt: new Date(),
              asaasPaymentId: payload.payment.id,
              payerName: payerNameFromCustomer,
              description: standaloneSubRecord.description ?? 'Assinatura recorrente',
              value: payload.payment.value,
              dueDate: vencimento,
              billingType: payload.payment.billingType ?? standaloneSubRecord.billingType,
              customerId: standaloneSubRecord.customerId,
              standaloneSubscriptionId: standaloneSubRecord.id,
              familyGroupId: standaloneSubRecord.familyGroupId,
              invoiceUrl: payload.payment.invoiceUrl ?? null,
              ...buildChargeAsaasSnapshotUpdate(payload, { localChargeStatus: chargeStatus }),
            },
            select: { id: true },
          });

          await refreshReadModel({ chargeId: standaloneSubscriptionCharge.id });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.standalone_subscription_charge_created',
            entity: {
              type: 'Charge',
              id: standaloneSubscriptionCharge.id,
            },
            metadata: {
              event: payload.event,
              asaasPaymentId: payload.payment.id,
              asaasSubscriptionId: subscriptionId,
              externalReference: externalRef,
              standaloneSubscriptionId: standaloneSubRecord.id,
              familyGroupId: standaloneSubRecord.familyGroupId,
            },
          });

          await publishPaymentRealtimeUpdate({
            contaId,
            entityId: standaloneSubscriptionCharge.id,
            payload,
            dueDate: vencimento,
          });

          return { success: true };
        }

        // Fallback legado: buscar no auditLog (para subscriptions criadas antes da migração)
        const manualLogs = await prisma.auditLog.findMany({
          where: {
            contaId,
            action: 'finance.standalone_subscription.created',
            entityType: 'StandaloneSubscription',
          },
          orderBy: { createdAt: 'desc' },
          select: { entityId: true, metadata: true },
        });

        const manualStandalone = manualLogs.find((log) => {
          if (!log.metadata || typeof log.metadata !== 'object' || Array.isArray(log.metadata)) {
            return false;
          }
          const metadata = log.metadata as Record<string, unknown>;
          return metadata.asaasSubscriptionId === subscriptionId;
        });

        if (manualStandalone?.metadata && typeof manualStandalone.metadata === 'object' && !Array.isArray(manualStandalone.metadata)) {
          const metadata = manualStandalone.metadata as Record<string, unknown>;
          const parentExternalReference =
            typeof metadata.externalReference === 'string' ? metadata.externalReference : null;

          if (parentExternalReference) {
            const externalRef = buildPaymentExternalReference(parentExternalReference, payload.payment.id);
            const rawStatus = typeof payload.payment.status === 'string' ? payload.payment.status : '';
            const normalizedStatus = rawStatus.trim().toUpperCase();
            const chargeStatus = mapAsaasToChargeStatus(normalizedStatus);
            const parsedDueDate = payload.payment.dueDate;
            const vencimento = parsedDueDate ? new Date(parsedDueDate) : new Date();
            const payerName =
              typeof metadata.payerName === 'string' && metadata.payerName.trim().length > 0
                ? metadata.payerName
                : 'Cliente';
            const description =
              typeof metadata.description === 'string' && metadata.description.trim().length > 0
                ? metadata.description
                : 'Assinatura recorrente';
            const billingTypeFromMetadata =
              typeof metadata.billingType === 'string' ? metadata.billingType : null;
            const customerId =
              typeof metadata.localCustomerId === 'string' ? metadata.localCustomerId : null;

            const standaloneSubscriptionCharge = await prisma.charge.upsert({
              where: {
                uq_charge_conta_asaas_payment: {
                  contaId,
                  asaasPaymentId: payload.payment.id,
                },
              },
              update: {
                externalReference: externalRef,
                status: chargeStatus,
                statusUpdatedAt: new Date(),
                billingType: payload.payment.billingType ?? billingTypeFromMetadata,
                dueDate: vencimento,
                value: payload.payment.value,
                description,
                customerId,
                invoiceUrl: resolveChargeInvoiceUrlUpdate(payload.payment.invoiceUrl),
                ...buildChargeAsaasSnapshotUpdate(payload, { localChargeStatus: chargeStatus }),
              },
              create: {
                contaId,
                externalReference: externalRef,
                status: chargeStatus,
                statusUpdatedAt: new Date(),
                asaasPaymentId: payload.payment.id,
                payerName,
                description,
                value: payload.payment.value,
                dueDate: vencimento,
                billingType: payload.payment.billingType ?? billingTypeFromMetadata,
                customerId,
                invoiceUrl: payload.payment.invoiceUrl ?? null,
                ...buildChargeAsaasSnapshotUpdate(payload, { localChargeStatus: chargeStatus }),
              },
              select: { id: true },
            });

            await refreshReadModel({ chargeId: standaloneSubscriptionCharge.id });

            await auditLogService.record({
              contaId,
              action: 'finance.webhook.standalone_subscription_charge_created',
              entity: {
                type: 'Charge',
                id: manualStandalone.entityId ?? payload.payment.id,
              },
              metadata: {
                event: payload.event,
                asaasPaymentId: payload.payment.id,
                asaasSubscriptionId: subscriptionId,
                externalReference: externalRef,
              },
            });

            await publishPaymentRealtimeUpdate({
              contaId,
              entityId: standaloneSubscriptionCharge.id,
              payload,
              dueDate: vencimento,
            });

            return { success: true };
          }
        }

        // Fallback: buscar matrícula via asaasSubscriptionId diretamente
        const matriculaFromSub = await prisma.matricula.findFirst({
          where: {
            aluno: { contaId },
            asaasSubscriptionId: subscriptionId,
          },
          select: {
            id: true,
            alunoId: true,
            planoId: true,
            comboId: true,
            vencimentoDia: true,
            plano: { select: { id: true, nome: true, valor: true } },
            combo: { select: { id: true, nome: true, valor: true } },
          },
        });

        if (!matriculaFromSub) {
          console.warn('Cobrança não encontrada e subscription não mapeada para payment.id:', payload.payment.id, {
            subscription: subscriptionId,
            externalReference: paymentExternalReference,
          });
        } else {
          // Criar cobrança automaticamente (via matrícula)
          const planoOuCombo = matriculaFromSub.combo ?? matriculaFromSub.plano;
          const descricao = planoOuCombo?.nome ? `Mensalidade - ${planoOuCombo.nome}` : 'Mensalidade';
          const parsedDueDate = (payload.payment as { dueDate?: string }).dueDate;
          const vencimento = parsedDueDate ? new Date(parsedDueDate) : new Date();

          const { cobranca: upserted } = await upsertCobrancaByAsaasPaymentId({
            contaId,
            asaasPaymentId: payload.payment.id,
            matriculaId: matriculaFromSub.id,
            tipo: 'MENSALIDADE',
            valor: payload.payment.value,
            vencimento,
            descricao,
            asaasStatus: effectiveAsaasStatus,
            asaasNetValue: payload.payment.netValue,
            formaPagamento: mapBillingTypeToFormaPagamento(payload.payment.billingType ?? '') ?? null,
          });
          cobranca = upserted;

          console.log('✅ Cobrança criada via webhook PAYMENT_CREATED:', {
            cobrancaId: cobranca.id,
            matriculaId: matriculaFromSub.id,
            asaasPaymentId: payload.payment.id,
            subscriptionId,
          });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.cobranca_created_from_subscription',
            entity: { type: 'Cobranca', id: cobranca.id },
            metadata: {
              event: payload.event,
              asaasPaymentId: payload.payment.id,
              asaasSubscriptionId: subscriptionId,
              matriculaId: matriculaFromSub.id,
              valor: payload.payment.value,
            },
          });
        }
      } else {
        // Criar cobrança usando dados da Subscription
        const matricula = subscription.matricula;
        const planoOuCombo = matricula.combo ?? matricula.plano;
        const descricao = planoOuCombo?.nome ? `Mensalidade - ${planoOuCombo.nome}` : 'Mensalidade';
        const parsedDueDate = (payload.payment as { dueDate?: string }).dueDate;
        const vencimento = parsedDueDate ? new Date(parsedDueDate) : new Date();

        const { cobranca: upsertedSub } = await upsertCobrancaByAsaasPaymentId({
          contaId,
          asaasPaymentId: payload.payment.id,
          matriculaId: matricula.id,
          tipo: 'MENSALIDADE',
          valor: payload.payment.value,
          vencimento,
          descricao,
          asaasStatus: effectiveAsaasStatus,
          asaasNetValue: payload.payment.netValue,
          formaPagamento: mapBillingTypeToFormaPagamento(payload.payment.billingType ?? '') ?? null,
        });
        cobranca = upsertedSub;

        console.log('✅ Cobrança criada via webhook PAYMENT_CREATED (subscription):', {
          cobrancaId: cobranca.id,
          matriculaId: matricula.id,
          subscriptionId: subscription.id,
          asaasPaymentId: payload.payment.id,
        });

        await auditLogService.record({
          contaId,
          action: 'finance.webhook.cobranca_created_from_subscription',
          entity: { type: 'Cobranca', id: cobranca.id },
          metadata: {
            event: payload.event,
            asaasPaymentId: payload.payment.id,
            asaasSubscriptionId: subscriptionId,
            subscriptionId: subscription.id,
            matriculaId: matricula.id,
            valor: payload.payment.value,
          },
        });
      }
    }

    // 1.3 Se não encontrou cobrança e é de um parcelamento, criar cobrança automaticamente
    if (!cobranca && payload.payment.installment) {
      const asaasInstallmentId = payload.payment.installment;
      const installmentNumber = payload.payment.installmentNumber ?? 1;

      // Buscar InstallmentPlan pelo asaasInstallmentId
      const installmentPlan = await prisma.installmentPlan.findFirst({
        where: {
          contaId,
          asaasInstallmentId,
        },
        select: {
          id: true,
          externalReference: true,
          matriculaId: true,
          installmentCount: true,
          value: true,
          matricula: {
            select: {
              id: true,
              alunoId: true,
              planoId: true,
              comboId: true,
              plano: { select: { id: true, nome: true } },
              combo: { select: { id: true, nome: true } },
            },
          },
        },
      });

      if (installmentPlan) {
        const matricula = installmentPlan.matricula;
        const planoOuCombo = matricula.combo ?? matricula.plano;
        const descricao = planoOuCombo?.nome
          ? `Parcela ${installmentNumber}/${installmentPlan.installmentCount} - ${planoOuCombo.nome}`
          : `Parcela ${installmentNumber}/${installmentPlan.installmentCount}`;
        const parsedDueDate = payload.payment.dueDate;
        const vencimento = parsedDueDate ? new Date(parsedDueDate) : new Date();

        const { cobranca: upsertedInstallment } = await upsertCobrancaByAsaasPaymentId({
          contaId,
          asaasPaymentId: payload.payment.id,
          matriculaId: matricula.id,
          tipo: 'PARCELADA',
          valor: payload.payment.value,
          vencimento,
          descricao,
          asaasStatus: effectiveAsaasStatus,
          asaasNetValue: payload.payment.netValue,
          formaPagamento: mapBillingTypeToFormaPagamento(payload.payment.billingType ?? '') ?? null,
        });
        cobranca = upsertedInstallment;

        console.log('✅ Cobrança criada via webhook PAYMENT_CREATED (installment):', {
          cobrancaId: cobranca.id,
          matriculaId: matricula.id,
          installmentPlanId: installmentPlan.id,
          installmentNumber,
          asaasPaymentId: payload.payment.id,
        });

        await auditLogService.record({
          contaId,
          action: 'finance.webhook.cobranca_created_from_installment',
          entity: { type: 'Cobranca', id: cobranca.id },
          metadata: {
            event: payload.event,
            asaasPaymentId: payload.payment.id,
            asaasInstallmentId,
            installmentPlanId: installmentPlan.id,
            installmentNumber,
            matriculaId: matricula.id,
            valor: payload.payment.value,
          },
        });

        // Criar Charge correspondente para listagem por externalReference
        const installmentChargeExternalRef = buildPaymentExternalReference(
          installmentPlan.externalReference,
          payload.payment.id
        );

        const installmentCharge = await prisma.charge.upsert({
          where: { cobrancaId: cobranca.id },
          update: {
            externalReference: installmentChargeExternalRef,
            asaasPaymentId: payload.payment.id,
            billingType: payload.payment.billingType ?? undefined,
            dueDate: resolveChargeDueDateUpdate(payload.payment.dueDate),
            value: payload.payment.value,
            description: payload.payment.description ?? undefined,
            invoiceUrl: resolveChargeInvoiceUrlUpdate(payload.payment.invoiceUrl),
          },
          create: {
            id: cobranca.id,
            contaId,
            cobrancaId: cobranca.id,
            externalReference: installmentChargeExternalRef,
            status: 'CREATED',
            statusUpdatedAt: new Date(),
            asaasPaymentId: payload.payment.id,
            description: payload.payment.description ?? null,
            value: payload.payment.value,
            dueDate: payload.payment.dueDate ? new Date(payload.payment.dueDate) : null,
            billingType: payload.payment.billingType ?? null,
            invoiceUrl: payload.payment.invoiceUrl ?? null,
          },
          select: { id: true },
        });

        await refreshReadModel({ chargeId: installmentCharge.id, cobrancaId: cobranca.id });
      } else {
        const standalonePlan = await prisma.standaloneInstallmentPlan.findFirst({
          where: { contaId, asaasInstallmentId },
          select: {
            id: true,
            externalReference: true,
            billingType: true,
            customer: { select: { id: true, payerType: true, payerId: true } },
          },
        });

        if (standalonePlan) {
          const payerName = await (async () => {
            if (standalonePlan.customer.payerType === 'RESPONSAVEL') {
              const resp = await prisma.responsavel.findFirst({
                where: { id: standalonePlan.customer.payerId, contaId },
                select: { nome: true },
              });
              return resp?.nome ?? 'Cliente';
            }

            const aluno = await prisma.aluno.findFirst({
              where: { id: standalonePlan.customer.payerId, contaId },
              select: { nome: true },
            });
            return aluno?.nome ?? 'Cliente';
          })();

          const externalRef = buildPaymentExternalReference(
            standalonePlan.externalReference,
            payload.payment.id
          );

          const rawStatus = typeof payload.payment.status === 'string' ? payload.payment.status : '';
          const normalizedStatus = rawStatus.trim().toUpperCase();
          const chargeStatus = mapAsaasToChargeStatus(normalizedStatus);
          const parsedDueDate = payload.payment.dueDate;
          const vencimento = parsedDueDate ? new Date(parsedDueDate) : new Date();

          const standaloneInstallmentCharge = await prisma.charge.upsert({
            where: {
              uq_charge_conta_asaas_payment: {
                contaId,
                asaasPaymentId: payload.payment.id,
              },
            },
            update: {
              externalReference: externalRef,
              status: chargeStatus,
              statusUpdatedAt: new Date(),
              billingType: payload.payment.billingType ?? standalonePlan.billingType,
              dueDate: vencimento,
              invoiceUrl: resolveChargeInvoiceUrlUpdate(payload.payment.invoiceUrl),
              ...buildChargeAsaasSnapshotUpdate(payload, { localChargeStatus: chargeStatus }),
            },
            create: {
              contaId,
              externalReference: externalRef,
              status: chargeStatus,
              statusUpdatedAt: new Date(),
              asaasPaymentId: payload.payment.id,
              payerName,
              description: (payload.payment as { description?: string | null }).description ?? null,
              value: payload.payment.value,
              dueDate: vencimento,
              billingType: payload.payment.billingType ?? standalonePlan.billingType,
              customerId: standalonePlan.customer.id,
              invoiceUrl: payload.payment.invoiceUrl ?? null,
              standaloneInstallmentPlanId: standalonePlan.id,
              ...buildChargeAsaasSnapshotUpdate(payload, { localChargeStatus: chargeStatus }),
            },
            select: { id: true },
          });

          await refreshReadModel({ chargeId: standaloneInstallmentCharge.id });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.standalone_installment_charge_created',
            entity: { type: 'Charge', id: payload.payment.id },
            metadata: {
              event: payload.event,
              asaasPaymentId: payload.payment.id,
              asaasInstallmentId,
              standaloneInstallmentPlanId: standalonePlan.id,
              installmentNumber,
              externalReference: externalRef,
            },
          });

          await publishPaymentRealtimeUpdate({
            contaId,
            entityId: standaloneInstallmentCharge.id,
            payload,
            dueDate: vencimento,
          });

          return { success: true };
        }

        console.warn('InstallmentPlan não encontrado para payment.id:', payload.payment.id, {
          installment: asaasInstallmentId,
          installmentNumber,
          externalReference: paymentExternalReference,
        });
      }
    }

    if (cobranca && !cobranca.asaasPaymentId) {
      await prisma.cobranca.update({
        where: { id: cobranca.id },
        data: { asaasPaymentId: payload.payment.id },
      });
      cobranca = {
        ...cobranca,
        asaasPaymentId: payload.payment.id,
      };
    }

    if (!cobranca) {
      const stagedReference = paymentExternalReference?.match(
        /^enrollment-op:([^:]+):(subscription|fee)$/,
      );
      if (stagedReference) {
        const [, operationId, kind] = stagedReference;
        const operation = await prisma.enrollmentCreationOperation.findFirst({
          where: { id: operationId, contaId },
          select: { id: true, status: true },
        });
        if (
          operation &&
          ['PROCESSING', 'REMOTE_PROVISIONED', 'REQUIRES_RECONCILIATION'].includes(
            operation.status,
          )
        ) {
          await prisma.enrollmentCreationOperation.updateMany({
            where: { id: operation.id, contaId },
            data:
              kind === 'fee'
                ? { asaasEnrollmentFeePaymentId: payload.payment.id }
                : { asaasFirstPaymentId: payload.payment.id },
          });
          await auditLogService.record({
            contaId,
            action: 'finance.webhook.enrollment_creation_payment_staged',
            entity: { type: 'EnrollmentCreationOperation', id: operation.id },
            metadata: {
              event: payload.event,
              kind,
              asaasPaymentId: payload.payment.id,
              subscription: payload.payment.subscription ?? null,
            },
          });
          return {
            success: false,
            error: 'ENROLLMENT_CREATION_IN_PROGRESS',
          };
        }
        if (operation && ['COMPENSATING', 'COMPENSATED'].includes(operation.status)) {
          return { success: true };
        }
      }

      const rawStatus = typeof payload.payment.status === 'string' ? payload.payment.status : '';
      const normalizedStatus = rawStatus.trim().toUpperCase();
      const placeholderExternalReference =
        paymentExternalReference && paymentExternalReference.trim().length > 0
          ? `${paymentExternalReference}:needs-review:${payload.payment.id}`
          : `needsReview:payment:${payload.payment.id}`;

      const parsedDueDate = payload.payment.dueDate;
      const placeholderDueDate = parsedDueDate ? new Date(parsedDueDate) : null;

      const placeholderCharge = await prisma.charge.upsert({
        where: {
          uq_charge_conta_asaas_payment: {
            contaId,
            asaasPaymentId: payload.payment.id,
          },
        },
        update: {
          status: mapAsaasToChargeStatus(normalizedStatus),
          statusUpdatedAt: new Date(),
          dueDate: placeholderDueDate,
          billingType: payload.payment.billingType ?? null,
          description: '[NEEDS_REVIEW] Payment sem vínculo local',
          value: payload.payment.value,
          invoiceUrl: resolveChargeInvoiceUrlUpdate(payload.payment.invoiceUrl),
          ...buildChargeAsaasSnapshotUpdate(payload, {
            localChargeStatus: mapAsaasToChargeStatus(normalizedStatus),
          }),
        },
        create: {
          contaId,
          externalReference: placeholderExternalReference,
          status: mapAsaasToChargeStatus(normalizedStatus),
          statusUpdatedAt: new Date(),
          asaasPaymentId: payload.payment.id,
          payerName: 'NEEDS_REVIEW',
          description: '[NEEDS_REVIEW] Payment sem vínculo local',
          value: payload.payment.value,
          dueDate: placeholderDueDate,
          billingType: payload.payment.billingType ?? null,
          invoiceUrl: payload.payment.invoiceUrl ?? null,
          ...buildChargeAsaasSnapshotUpdate(payload, {
            localChargeStatus: mapAsaasToChargeStatus(normalizedStatus),
          }),
        },
        select: { id: true },
      });

      await refreshReadModel({ chargeId: placeholderCharge.id });

      await upsertFinanceReconciliationIssue({
        contaId,
        entityType: 'CHARGE',
        entityId: placeholderCharge.id,
        asaasId: payload.payment.id,
        issueType: 'PAYMENT_NEEDS_REVIEW',
        severity: 'HIGH',
        localStatus: 'NEEDS_REVIEW',
        remoteStatus: normalizedStatus || null,
        metadata: {
          event: payload.event,
          subscription: payload.payment.subscription ?? null,
          installment: payload.payment.installment ?? null,
          installmentNumber: payload.payment.installmentNumber ?? null,
          externalReference: paymentExternalReference ?? null,
          source: 'payment-webhook-handler',
        },
      });

      console.warn('Cobrança não encontrada para payment.id:', payload.payment.id, {
        subscription: payload.payment.subscription,
        installment: payload.payment.installment,
        installmentNumber: payload.payment.installmentNumber,
        externalReference: paymentExternalReference,
      });

      await auditLogService.record({
        contaId,
        action: 'finance.webhook.cobranca_not_found',
        entity: { type: 'Payment', id: payload.payment.id },
        metadata: {
          event: payload.event,
          asaasPaymentId: payload.payment.id,
          subscription: payload.payment.subscription,
          installment: payload.payment.installment,
          installmentNumber: payload.payment.installmentNumber,
          externalReference: paymentExternalReference,
          createdPlaceholderCharge: true,
        },
      });

      await publishPaymentRealtimeUpdate({
        contaId,
        entityId: placeholderCharge.id,
        payload,
        dueDate: placeholderDueDate,
      });

      return { success: true };
    }

    if (payload.payment.subscription) {
      if (!subscriptionRecord) {
        subscriptionRecord = await prisma.subscription.findFirst({
          where: { contaId, asaasSubscriptionId: payload.payment.subscription },
          select: { id: true, externalReference: true },
        });
      }
    }

    await ensureAcademicChargeForCobranca({
      contaId,
      cobrancaId: cobranca.id,
      asaasPaymentId: payload.payment.id,
      subscriptionExternalReference: subscriptionRecord?.externalReference ?? null,
      payment: payload.payment,
    });

    // 2. Calcular próximo status com base no payload (fonte de verdade)
    const normalizedAsaasStatus =
      typeof payload.payment.status === 'string' ? payload.payment.status.trim().toUpperCase() : '';
    const internalStatus = resolveInternalPaymentStatus({
      eventName: payload.event,
      asaasPaymentStatus: normalizedAsaasStatus || null,
      billingType: payload.payment.billingType ?? null,
      deleted: payload.payment.deleted ?? null,
    });
    const currentStatus = cobranca.status;
    const occurredAt = new Date();

    const stateDecision = decideCobrancaPaymentTransition({
      currentLocalStatus: currentStatus,
      currentProviderStatus: cobranca.providerStatus ?? cobranca.asaasStatus,
      incomingProviderStatus: effectiveAsaasStatus,
      eventName: payload.event,
      billingType: payload.payment.billingType ?? null,
      dueDate: (payload.payment as { dueDate?: string }).dueDate ?? null,
      now: new Date(),
      source: payload.source ?? 'WEBHOOK',
    });

    const nextStatusCobranca = stateDecision.nextLocalStatus;
    const decisionReason = stateDecision.reason;
    const sensitivePaymentAuditMetadata = buildSensitivePaymentAuditMetadata({
      event: payload.event,
      internalStatus,
      currentStatus,
      nextStatus: nextStatusCobranca,
      payment: payload.payment,
    });

    if (decisionReason === 'REGRESSION_BLOCKED') {
      await auditLogService.record({
        contaId,
        action: 'finance.webhook.payment_status_regression_blocked',
        entity: { type: 'Cobranca', id: cobranca.id },
        metadata: {
          event: payload.event,
          asaasPaymentId: payload.payment.id,
          asaasStatus: effectiveAsaasStatus,
          internalStatus,
          currentStatus,
          attemptedStatus: nextStatusCobranca,
          currentPrecedence: getCobrancaPrecedence(currentStatus),
          attemptedPrecedence: getCobrancaPrecedence(nextStatusCobranca),
          decisionReason,
        },
      });

      console.warn('⚠️ Regressão de status bloqueada:', {
        cobrancaId: cobranca.id,
        currentStatus,
        attemptedStatus: nextStatusCobranca,
        event: payload.event,
        decisionReason,
      });
    } else if (decisionReason === 'OUT_OF_ORDER_EVENT_IGNORED') {
      console.info('[paymentWebhook] Evento fora de ordem ignorado', {
        cobrancaId: cobranca.id,
        currentStatus,
        attemptedStatus: nextStatusCobranca,
        event: payload.event,
        decisionReason,
      });
    }

    // 3.5. PAYMENT_UPDATED: reconciliar vencimento, valor e forma de pagamento
    if (payload.event === 'PAYMENT_UPDATED') {
      const isMutable = ['PENDENTE', 'A_VENCER'].includes(currentStatus);
      const updatedDueDate = payload.payment.dueDate ? new Date(payload.payment.dueDate) : null;
      const updatedValue = payload.payment.value;
      const updatedBillingType = payload.payment.billingType ?? null;

      if (isMutable) {
        const reconcileData: Record<string, unknown> = {};
        if (updatedDueDate) reconcileData.vencimento = updatedDueDate;
        if (updatedValue > 0) reconcileData.valor = updatedValue;
        if (updatedBillingType) {
          const mapped = mapBillingTypeToFormaPagamento(updatedBillingType);
          if (mapped) reconcileData.formaPagamento = mapped;
        }

        if (Object.keys(reconcileData).length > 0) {
          await prisma.cobranca.update({
            where: { id: cobranca.id },
            data: reconcileData,
          });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.payment_updated_reconciled',
            entity: { type: 'Cobranca', id: cobranca.id },
            metadata: {
              asaasPaymentId: payload.payment.id,
              reconciledFields: Object.keys(reconcileData),
              newDueDate: updatedDueDate?.toISOString() ?? null,
              newValue: updatedValue,
              newBillingType: updatedBillingType,
              matriculaId: cobranca.matriculaId,
            },
          });
        }
      } else {
        // Política local não permite overwrite em status avançado: auditaria divergência
        await auditLogService.record({
          contaId,
          action: 'finance.webhook.payment_updated_divergence',
          entity: { type: 'Cobranca', id: cobranca.id },
          metadata: {
            asaasPaymentId: payload.payment.id,
            currentStatus,
            reason: 'IMMUTABLE_STATUS',
            remoteDueDate: updatedDueDate?.toISOString() ?? null,
            remoteValue: updatedValue,
            remoteBillingType: updatedBillingType,
            matriculaId: cobranca.matriculaId,
          },
        });
      }
    }

    // 3.6. PAYMENT_REPROVED_BY_RISK_ANALYSIS / PAYMENT_CREDIT_CARD_CAPTURE_REFUSED
    // Registra warningCode e marca divergência operacional sem inferir pagamento
    if (
      payload.event === 'PAYMENT_REPROVED_BY_RISK_ANALYSIS' ||
      payload.event === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
    ) {
      const warningReason = payload.event === 'PAYMENT_REPROVED_BY_RISK_ANALYSIS'
        ? 'RISK_ANALYSIS_REPROVED'
        : 'CREDIT_CARD_CAPTURE_REFUSED';

      await prisma.cobranca.update({
        where: { id: cobranca.id },
        data: {
          asaasStatus: effectiveAsaasStatus,
          lastAsaasFetchAt: new Date(),
        },
      });

      const riskCharge = chargeFromExternalRef?.cobrancaId === cobranca.id
        ? chargeFromExternalRef
        : await prisma.charge.findFirst({
            where: { contaId, OR: [{ asaasPaymentId: payload.payment.id }, { cobrancaId: cobranca.id }] },
            select: { id: true, status: true, asaasPaymentId: true, cobrancaId: true, asaasStatus: true, providerStatus: true },
          });

      if (riskCharge) {
        await prisma.charge.update({
          where: { id: riskCharge.id },
          data: { statusUpdatedAt: new Date() },
        });
        await refreshReadModel({ chargeId: riskCharge.id, cobrancaId: cobranca.id });
      }

      await auditLogService.record({
        contaId,
        action: 'finance.webhook.payment_risk_event',
        entity: { type: 'Cobranca', id: cobranca.id },
        metadata: {
          event: payload.event,
          warningReason,
          asaasPaymentId: payload.payment.id,
          asaasStatus: effectiveAsaasStatus,
          billingType: payload.payment.billingType ?? null,
          value: payload.payment.value,
          currentStatus,
          matriculaId: cobranca.matriculaId,
        },
      });
    }

    // 3.7. PAYMENT_RESTORED: reabertura controlada
    if (payload.event === 'PAYMENT_RESTORED') {
      const canRestore = ['CANCELADO', 'CANCELAMENTO_PENDENTE'].includes(currentStatus);
      const isBlockedByHigherTerminal = ['ESTORNADO', 'ESTORNADO_PARCIAL'].includes(currentStatus);

      if (canRestore && !isBlockedByHigherTerminal) {
        const restoredDueDate = payload.payment.dueDate ? new Date(payload.payment.dueDate) : null;
        const nowDate = new Date();
        const restoreStateDimensionUpdate = buildPaymentStateDimensionUpdate({
          payload,
          decision: stateDecision,
          now: nowDate,
        });
        const restoredStatus: typeof currentStatus = restoredDueDate && restoredDueDate > nowDate
          ? 'A_VENCER'
          : 'PENDENTE';

        await prisma.cobranca.update({
          where: { id: cobranca.id },
          data: {
            status: restoredStatus,
            asaasStatus: effectiveAsaasStatus,
            providerStatus: stateDecision.nextProviderStatus,
            lastAsaasFetchAt: nowDate,
            ...restoreStateDimensionUpdate,
          },
        });

        const restoredCharge = chargeFromExternalRef?.cobrancaId === cobranca.id
          ? chargeFromExternalRef
          : await prisma.charge.findFirst({
              where: { contaId, OR: [{ asaasPaymentId: payload.payment.id }, { cobrancaId: cobranca.id }] },
              select: { id: true, status: true, asaasPaymentId: true, cobrancaId: true, asaasStatus: true, providerStatus: true },
            });

        if (restoredCharge && restoredCharge.status === 'CANCELED') {
          const restoredChargeDecision = decideChargePaymentTransition({
            currentLocalStatus: restoredCharge.status,
            currentProviderStatus: restoredCharge.providerStatus ?? restoredCharge.asaasStatus,
            incomingProviderStatus: effectiveAsaasStatus,
            internalStatus,
            eventName: payload.event,
            source: payload.source ?? 'WEBHOOK',
          });
          await prisma.charge.update({
            where: { id: restoredCharge.id },
            data: {
              status: 'OPEN',
              statusUpdatedAt: nowDate,
              providerStatus: restoredChargeDecision.nextProviderStatus,
              ...buildPaymentStateDimensionUpdate({
                payload,
                decision: restoredChargeDecision,
                now: nowDate,
              }),
            },
          });
          await recordPaymentStateTransition({
            contaId,
            entityType: 'CHARGE',
            entityId: restoredCharge.id,
            source: payload.source ?? 'WEBHOOK',
            sourceId: payload.eventId ?? `payment:${payload.payment.id}:${payload.event}`,
            decision: restoredChargeDecision,
            providerOccurredAt: payload.providerOccurredAt ?? null,
            metadata: { asaasPaymentId: payload.payment.id },
          });
        }

        await auditLogService.record({
          contaId,
          action: 'finance.webhook.payment_restored',
          entity: { type: 'Cobranca', id: cobranca.id },
          metadata: {
            asaasPaymentId: payload.payment.id,
            previousStatus: currentStatus,
            restoredStatus,
            asaasStatus: effectiveAsaasStatus,
            matriculaId: cobranca.matriculaId,
          },
        });

        await refreshReadModel({
          chargeId: restoredCharge?.id ?? null,
          cobrancaId: cobranca.id,
        });

        await recordPaymentStateTransition({
          contaId,
          entityType: 'COBRANCA',
          entityId: cobranca.id,
          source: payload.source ?? 'WEBHOOK',
          sourceId: payload.eventId ?? `payment:${payload.payment.id}:${payload.event}`,
          decision: stateDecision,
          providerOccurredAt: payload.providerOccurredAt ?? null,
          localVersion: (cobranca.version ?? 0) + (stateDecision.kind === 'APPLY' ? 1 : 0),
          metadata: { asaasPaymentId: payload.payment.id },
        });

        return { success: true };
      }

      await prisma.cobranca.update({
        where: { id: cobranca.id },
        data: {
          asaasStatus: effectiveAsaasStatus,
          providerStatus: stateDecision.nextProviderStatus,
          lastAsaasFetchAt: new Date(),
          ...buildPaymentStateDimensionUpdate({ payload, decision: stateDecision, now: new Date() }),
        },
      });
      await auditLogService.record({
        contaId,
        action: 'finance.webhook.payment_restored_blocked',
        entity: { type: 'Cobranca', id: cobranca.id },
        metadata: {
          asaasPaymentId: payload.payment.id,
          currentStatus,
          reason: isBlockedByHigherTerminal
            ? 'BLOCKED_BY_TERMINAL_REFUND'
            : 'STATUS_NOT_RESTORABLE',
          matriculaId: cobranca.matriculaId,
        },
      });
      await recordPaymentStateTransition({
        contaId,
        entityType: 'COBRANCA',
        entityId: cobranca.id,
        source: payload.source ?? 'WEBHOOK',
        sourceId: payload.eventId ?? `payment:${payload.payment.id}:${payload.event}`,
        decision: stateDecision,
        providerOccurredAt: payload.providerOccurredAt ?? null,
        localVersion: cobranca.version ?? 0,
        metadata: { asaasPaymentId: payload.payment.id },
      });

      return { success: true };
    }

    // 4. Atualizar status da cobrança + campos asaas* (apenas se houver progressão de status)
    // IMPORTANTE: campos asaas* são sempre atualizados quando há progressão de status
    const p = payload.payment;
    const liquidacaoStatus = computeLiquidacaoStatusFromPayload(payload);
    const feeValue = p.value - p.netValue;
    const isConfirmed = internalStatus === 'CONFIRMED' || internalStatus === 'RECEIVED_IN_CASH';
    const paymentDateStr = p.paymentDate ?? p.clientPaymentDate ?? p.creditDate;
    const paymentDate = paymentDateStr ? new Date(paymentDateStr) : new Date();
    const cobrancaSensitiveUpdate = buildCobrancaSensitiveUpdate({
      event: payload.event,
      internalStatus,
      occurredAt,
    });
    const cobrancaPaymentUpdate = isConfirmed
      ? {
          dataPagamento: paymentDate,
          pagoEm: paymentDate,
        }
      : payload.event === 'PAYMENT_RECEIVED_IN_CASH_UNDONE'
        ? {
            dataPagamento: null,
            pagoEm: null,
          }
        : {};

    const resolvedCobrancaAsaasStatus = resolveCobrancaAsaasStatusFromPayload(payload, {
      currentAsaasStatus: cobranca.providerStatus ?? cobranca.asaasStatus,
      localCobrancaStatus: currentStatus,
      localChargeStatus:
        chargeFromExternalRef?.cobrancaId === cobranca.id ? chargeFromExternalRef.status : null,
    });
    const cobrancaStateDimensionUpdate = buildPaymentStateDimensionUpdate({
      payload,
      decision: stateDecision,
      now: occurredAt,
    });

    if (currentStatus !== nextStatusCobranca) {
      await prisma.cobranca.update({
        where: { id: cobranca.id },
        data: {
          status: nextStatusCobranca,
          // Campos asaas* (snapshot do Asaas - fonte da verdade)
          asaasStatus: resolvedCobrancaAsaasStatus,
          providerStatus: stateDecision.nextProviderStatus,
          asaasValue: p.value,
          asaasNetValue: p.netValue,
          asaasOriginalValue: p.originalValue ?? null,
          asaasFeeValue: feeValue,
          asaasCreditDate: p.creditDate ? new Date(p.creditDate) : null,
          asaasEstimatedCreditDate: p.estimatedCreditDate ? new Date(p.estimatedCreditDate) : null,
          lastAsaasFetchAt: new Date(),
          // Liquidação: para RECEIVED_IN_CASH, usar paymentDate como data de liquidação
          liquidacaoStatus,
          liquidadoEm: liquidacaoStatus === 'DISPONIVEL' ? paymentDate : null,
          ...cobrancaSensitiveUpdate,
          ...cobrancaPaymentUpdate,
          ...cobrancaStateDimensionUpdate,
        },
      });
    } else {
      // Mesmo sem progressão de status, atualizar campos asaas* se o status já é o mesmo
      // (pode haver atualização de creditDate sem mudança de status)
      await prisma.cobranca.update({
        where: { id: cobranca.id },
        data: {
          asaasStatus: resolvedCobrancaAsaasStatus,
          providerStatus: stateDecision.nextProviderStatus,
          asaasValue: p.value,
          asaasNetValue: p.netValue,
          asaasOriginalValue: p.originalValue ?? null,
          asaasFeeValue: feeValue,
          asaasCreditDate: p.creditDate ? new Date(p.creditDate) : null,
          asaasEstimatedCreditDate: p.estimatedCreditDate ? new Date(p.estimatedCreditDate) : null,
          lastAsaasFetchAt: new Date(),
          // Liquidação: para RECEIVED_IN_CASH, usar paymentDate como data de liquidação
          liquidacaoStatus,
          liquidadoEm: liquidacaoStatus === 'DISPONIVEL' ? paymentDate : null,
          ...cobrancaSensitiveUpdate,
          ...cobrancaPaymentUpdate,
          ...cobrancaStateDimensionUpdate,
        },
      });
    }

    if (cobranca.tipo === 'TAXA_MATRICULA') {
      await projectAcademicEnrollmentFeeState({
        contaId,
        cobrancaId: cobranca.id,
        eventName: payload.event,
      });
    }

    const nextFinanceStatus = resolveMatriculaFinanceStatusForCharge({
      chargeType: cobranca.tipo,
      nextChargeStatus: nextStatusCobranca,
    });

    if (nextFinanceStatus && cobranca.tipo !== 'TAXA_MATRICULA') {
      await updateFinanceStatusFromPayment({
        matriculaId: cobranca.matriculaId,
        newStatus: nextFinanceStatus,
        eventName: payload.event,
        reason: `Webhook Asaas: ${payload.event}`,
      });
    }

    // 5. Atualizar charge correspondente (se existir)
    const charge =
      chargeFromExternalRef && chargeFromExternalRef.cobrancaId === cobranca.id
        ? chargeFromExternalRef
        : await prisma.charge.findFirst({
            where: {
              contaId,
              OR: [{ asaasPaymentId: payload.payment.id }, { cobrancaId: cobranca.id }],
            },
            select: { id: true, status: true, asaasPaymentId: true, cobrancaId: true, asaasStatus: true, providerStatus: true },
          });

    let chargeStateDecision: ChargeStateDecision | null = null;
    if (charge) {
      chargeStateDecision = decideChargePaymentTransition({
        currentLocalStatus: charge.status,
        currentProviderStatus: charge.providerStatus ?? charge.asaasStatus,
        incomingProviderStatus: effectiveAsaasStatus,
        internalStatus,
        eventName: payload.event,
        source: payload.source ?? 'WEBHOOK',
      });
      const nextStatusChargeForThisCharge = chargeStateDecision.nextLocalStatus;
      const chargeStateDimensionUpdate = buildPaymentStateDimensionUpdate({
        payload,
        decision: chargeStateDecision,
        now: occurredAt,
      });
      const baseChargeUpdate = {
        ...buildChargeAsaasSnapshotUpdate(payload, {
          currentAsaasStatus: charge.providerStatus ?? charge.asaasStatus,
          localChargeStatus: charge.status,
          localCobrancaStatus: cobranca.status,
        }),
        ...chargeStateDimensionUpdate,
        ...(charge.asaasPaymentId ? {} : { asaasPaymentId: payload.payment.id }),
      };

      if (charge.status !== nextStatusChargeForThisCharge) {
        if (chargeStateDecision.kind === 'APPLY') {
          await prisma.charge.update({
            where: { id: charge.id },
            data: { ...baseChargeUpdate, status: nextStatusChargeForThisCharge, statusUpdatedAt: new Date() },
          });
        } else {
          // Regressão em charge também é bloqueada — persiste snapshot Asaas mesmo assim
          console.warn('⚠️ Regressão de status charge bloqueada:', {
            chargeId: charge.id,
            currentStatus: charge.status,
            attemptedStatus: nextStatusChargeForThisCharge,
          });
          await prisma.charge.update({
            where: { id: charge.id },
            data: { ...baseChargeUpdate, statusUpdatedAt: new Date() },
          });
        }
      } else {
        await prisma.charge.update({
          where: { id: charge.id },
          data: baseChargeUpdate,
        });
      }
    }

    try {
      await handleChargeInvoicePaymentEvent({
        contaId,
        chargeId: charge?.id ?? null,
        asaasPaymentId: p.id,
        event: payload.event,
        providerStatus: p.status,
        asaasPaymentSubscription: p.subscription,
      });
    } catch (invoiceSideEffectError) {
      console.error('[payment-webhook] Falha ao aplicar side effect fiscal:', {
        contaId,
        cobrancaId: cobranca.id,
        chargeId: charge?.id ?? null,
        asaasPaymentId: p.id,
        error:
          invoiceSideEffectError instanceof Error
            ? invoiceSideEffectError.message
            : String(invoiceSideEffectError),
      });
    }

    // 6. Materializar Pagamento ao confirmar; Lançamento somente quando liquidado
    const shouldRecordPayment = isConfirmed;
    const shouldMaterializeLancamento = isConfirmed && liquidacaoStatus === 'DISPONIVEL';
    let pagamentoId: string | null = null;

    if (shouldRecordPayment) {
      const existingPagamento = await prisma.pagamento.findFirst({
        where: { contaId, asaasPaymentId: p.id },
        select: { id: true },
      });

      if (existingPagamento) {
        const updated = await prisma.pagamento.update({
          where: { id: existingPagamento.id },
          data: {
            dataPagamento: paymentDate,
            valorPago: p.value,
            status: 'CONFIRMADO',
          },
        });
        pagamentoId = updated.id;
      } else {
        const created = await prisma.pagamento.create({
          data: {
            contaId,
            cobrancaId: cobranca.id,
            dataPagamento: paymentDate,
            formaPagamento: cobranca.formaPagamento as unknown as string,
            valorPago: p.value,
            status: 'CONFIRMADO',
            asaasPaymentId: p.id,
          },
        });
        pagamentoId = created.id;
      }
    }

    if (shouldMaterializeLancamento) {
      const lancamentoExternalRef = `asaas:payment:${p.id}`;
      const lancamentoIdempotencyKey = `${lancamentoExternalRef}:settlement`;
      const existingLancamento = await prisma.lancamento.findFirst({
        where: {
          contaId,
          OR: [
            { idempotencyKey: lancamentoIdempotencyKey },
            { externalRef: lancamentoExternalRef, isEstorno: false },
          ],
        },
        select: { id: true },
      });

      if (!existingLancamento) {
        const lancamentoValor = p.netValue > 0 ? p.netValue : p.value;
        await createLedgerEntryIdempotently(prisma, {
          contaId,
          tipo: 'RECEITA' as TipoLancamento,
          origem: 'SISTEMA' as OrigemLancamento,
          status: 'RECEBIDO' as StatusLancamento,
          valor: lancamentoValor,
          descricao: `Pagamento confirmado (${cobranca.id})`,
          referencia: `pagamento:${p.id}`,
          formaPagamento: mapFormaPagamentoToLancamento(cobranca.formaPagamento as FormaPagamento),
          dataEfetiva: paymentDate,
          dataPrevista: paymentDate,
          externalRef: lancamentoExternalRef,
          idempotencyKey: lancamentoIdempotencyKey,
        });
      }
    }

    if (shouldRecordPayment) {
      await prisma.logIntegracao.create({
        data: {
          contaId,
          tipoOperacao: 'WEBHOOK',
          entidade: 'PAYMENT',
          entidadeId: cobranca.id,
          asaasId: p.id,
          status: 'PROCESSADO',
          idempotencyKey: p.id,
          response: {
            status: 'CONFIRMADO',
            liquidacaoStatus,
            pagamentoId,
          } as never,
        },
      });
    }

    if (payload.event === 'PAYMENT_PARTIALLY_REFUNDED') {
      const existingPagamento = await prisma.pagamento.findFirst({
        where: { contaId, asaasPaymentId: p.id },
        select: { id: true },
      });

      if (existingPagamento) {
        await prisma.pagamento.update({
          where: { id: existingPagamento.id },
          data: {
            status: 'ESTORNADO_PARCIAL',
            valorPago: p.value,
          },
        });
      }

      const lancamentoExternalRef = `asaas:payment:${p.id}`;
      const partialRefundIdempotencyKey = `${lancamentoExternalRef}:partial-refund`;
      const originalLancamento = await prisma.lancamento.findFirst({
        where: {
          contaId,
          externalRef: lancamentoExternalRef,
          isEstorno: false,
        },
      });

      if (originalLancamento) {
        const currentNetValue = p.netValue > 0 ? p.netValue : p.value;
        const refundedAmount = Math.max(Number(originalLancamento.valor) - currentNetValue, 0);
        const partialRefundExternalRef = `${lancamentoExternalRef}:partial-refund`;

        if (refundedAmount > 0) {
          const partialRefundEntry = await prisma.lancamento.findFirst({
            where: {
              contaId,
              OR: [
                { idempotencyKey: partialRefundIdempotencyKey },
                {
                  parentId: originalLancamento.id,
                  isEstorno: true,
                  externalRef: partialRefundExternalRef,
                },
              ],
            },
            select: { id: true },
          });

          if (partialRefundEntry) {
            await prisma.lancamento.update({
              where: { id: partialRefundEntry.id },
              data: {
                valor: refundedAmount,
                dataEstorno: occurredAt,
                motivoEstorno: 'Webhook Asaas: estorno parcial',
              },
            });
          } else {
            await createLedgerEntryIdempotently(prisma, {
              contaId,
              tipo: originalLancamento.tipo as TipoLancamento,
              origem: originalLancamento.origem as OrigemLancamento,
              status: 'ESTORNADO' as StatusLancamento,
              valor: refundedAmount,
              descricao: `Estorno parcial de ${originalLancamento.descricao}`,
              referencia: originalLancamento.referencia,
              formaPagamento: originalLancamento.formaPagamento,
              dataEfetiva: occurredAt,
              dataPrevista: null,
              isEstorno: true,
              parentId: originalLancamento.id,
              dataEstorno: occurredAt,
              motivoEstorno: 'Webhook Asaas: estorno parcial',
              externalRef: partialRefundExternalRef,
              idempotencyKey: partialRefundIdempotencyKey,
            });
          }
        }
      }
    } else if (internalStatus === 'REFUNDED' || internalStatus === 'CHARGEBACK') {
      const existingPagamento = await prisma.pagamento.findFirst({
        where: { contaId, asaasPaymentId: p.id },
        select: { id: true },
      });

      if (existingPagamento) {
        await prisma.pagamento.update({
          where: { id: existingPagamento.id },
          data: { status: 'ESTORNADO' },
        });
      }

      const lancamentoExternalRef = `asaas:payment:${p.id}`;
      const refundIdempotencyKey = `${lancamentoExternalRef}:refund`;
      const originalLancamento = await prisma.lancamento.findFirst({
        where: {
          contaId,
          externalRef: lancamentoExternalRef,
          isEstorno: false,
        },
      });

      if (originalLancamento && originalLancamento.status !== 'ESTORNADO') {
        const dataEstorno = occurredAt;
        await prisma.$transaction(async (tx) => {
          await tx.lancamento.update({
            where: { id: originalLancamento.id },
            data: {
              status: 'ESTORNADO',
              dataEstorno,
              motivoEstorno: internalStatus === 'CHARGEBACK'
                ? `Chargeback confirmado via ${payload.event}`
                : `Estorno confirmado via ${payload.event}`,
            },
          });

          const estornoExists = await tx.lancamento.findFirst({
            where: {
              contaId,
              OR: [
                { idempotencyKey: refundIdempotencyKey },
                { parentId: originalLancamento.id, isEstorno: true },
              ],
            },
            select: { id: true },
          });

          if (!estornoExists) {
            await createLedgerEntryIdempotently(tx, {
              contaId,
              tipo: originalLancamento.tipo as TipoLancamento,
              origem: originalLancamento.origem as OrigemLancamento,
              status: 'ESTORNADO' as StatusLancamento,
              valor: originalLancamento.valor,
              descricao: `Estorno de ${originalLancamento.descricao}`,
              referencia: originalLancamento.referencia,
              formaPagamento: originalLancamento.formaPagamento,
              dataEfetiva: dataEstorno,
              dataPrevista: null,
              isEstorno: true,
              parentId: originalLancamento.id,
              dataEstorno,
              motivoEstorno: internalStatus === 'CHARGEBACK'
                ? `Chargeback confirmado via ${payload.event}`
                : `Estorno confirmado via ${payload.event}`,
              externalRef: originalLancamento.externalRef,
              idempotencyKey: refundIdempotencyKey,
            });
          }
        });
      }
    }

    if (payload.event === 'PAYMENT_RECEIVED_IN_CASH_UNDONE') {
      const existingPagamento = await prisma.pagamento.findFirst({
        where: { contaId, asaasPaymentId: p.id },
        select: { id: true },
      });

      if (existingPagamento) {
        await prisma.pagamento.update({
          where: { id: existingPagamento.id },
          data: {
            status: 'CANCELADO',
            dataPagamento: null,
          },
        });
      }

      const lancamentoExternalRef = `asaas:payment:${p.id}`;
      const cashUndoIdempotencyKey = `${lancamentoExternalRef}:cash-undo`;
      const originalLancamento = await prisma.lancamento.findFirst({
        where: {
          contaId,
          externalRef: lancamentoExternalRef,
          isEstorno: false,
        },
      });

      if (originalLancamento && originalLancamento.status !== 'ESTORNADO') {
        const dataEstorno = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.lancamento.update({
            where: { id: originalLancamento.id },
            data: {
              status: 'ESTORNADO',
              dataEstorno,
              motivoEstorno: 'Recebimento em dinheiro desfeito no Asaas',
            },
          });

          const estornoExists = await tx.lancamento.findFirst({
            where: {
              contaId,
              OR: [
                { idempotencyKey: cashUndoIdempotencyKey },
                { parentId: originalLancamento.id, isEstorno: true },
              ],
            },
            select: { id: true },
          });

          if (!estornoExists) {
            await createLedgerEntryIdempotently(tx, {
              contaId,
              tipo: originalLancamento.tipo as TipoLancamento,
              origem: originalLancamento.origem as OrigemLancamento,
              status: 'ESTORNADO' as StatusLancamento,
              valor: originalLancamento.valor,
              descricao: `Reversão de ${originalLancamento.descricao}`,
              referencia: originalLancamento.referencia,
              formaPagamento: originalLancamento.formaPagamento,
              dataEfetiva: dataEstorno,
              dataPrevista: null,
              isEstorno: true,
              parentId: originalLancamento.id,
              dataEstorno,
              externalRef: originalLancamento.externalRef,
              idempotencyKey: cashUndoIdempotencyKey,
            });
          }
        });
      }
    }

    await auditLogService.record({
      contaId,
      action: 'finance.webhook.payment_status_changed',
      entity: { type: 'Cobranca', id: cobranca.id },
      metadata: {
        event: payload.event,
        asaasPaymentId: payload.payment.id,
        asaasStatus: effectiveAsaasStatus,
        internalStatus,
        previousStatus: currentStatus,
        nextStatus: nextStatusCobranca,
        decision: currentStatus === nextStatusCobranca ? 'MANTEVE' : 'ATUALIZOU',
        decisionReason,
        matriculaId: cobranca.matriculaId,
        pagamentoId,
        liquidacaoStatus,
      },
    });

    if (sensitivePaymentAuditMetadata) {
      await auditLogService.record({
        contaId,
        action: 'finance.webhook.payment_sensitive_event',
        entity: { type: 'Cobranca', id: cobranca.id },
        metadata: {
          ...sensitivePaymentAuditMetadata,
          matriculaId: cobranca.matriculaId,
          decisionReason,
        },
      });
    }

    console.log('✅ Webhook processado:', {
      cobrancaId: cobranca.id,
      matriculaId: cobranca.matriculaId,
      asaasStatus: effectiveAsaasStatus,
      billingType: payload.payment.billingType ?? null,
      internalStatus,
      nextStatusCobranca,
    });

    await refreshReadModel({
      chargeId: charge?.id ?? null,
      cobrancaId: cobranca.id,
    });

    const stateSource = payload.source ?? 'WEBHOOK';
    const stateSourceId = payload.eventId ?? `payment:${p.id}:${payload.event}`;
    await recordPaymentStateTransition({
      contaId,
      entityType: 'COBRANCA',
      entityId: cobranca.id,
      source: stateSource,
      sourceId: stateSourceId,
      decision: stateDecision,
      providerOccurredAt: payload.providerOccurredAt ?? null,
      localVersion: (cobranca.version ?? 0) + (stateDecision.kind === 'APPLY' ? 1 : 0),
      metadata: {
        asaasPaymentId: p.id,
        internalStatus,
        liquidacaoStatus,
      },
    });
    if (charge && chargeStateDecision) {
      await recordPaymentStateTransition({
        contaId,
        entityType: 'CHARGE',
        entityId: charge.id,
        source: stateSource,
        sourceId: stateSourceId,
        decision: chargeStateDecision,
        providerOccurredAt: payload.providerOccurredAt ?? null,
        metadata: { asaasPaymentId: p.id },
      });
    }

    await publishFinanceEvent({
      contaId,
      type: 'cobranca.updated',
      entityId: cobranca.id,
      asaasPaymentId: payload.payment.id,
      status: nextStatusCobranca,
      liquidacaoStatus,
      asaasStatus: effectiveAsaasStatus,
      revision: Date.now(),
    });

    try {
      await updateEventFinancialEntryFromWebhook(contaId, payload);
    } catch (err) {
      console.error('[handlePaymentWebhookCore] Falha ao sincronizar EventFinancialEntry:', err);
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Erro ao processar webhook:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}
