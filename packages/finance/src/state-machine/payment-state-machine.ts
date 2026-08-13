import type { ChargeStatus, StatusCobranca } from '@prisma/client';

import {
  canApplyChargeStatusTransition,
  computeNextChargeStatus,
  computeNextCobrancaStatus,
  type CobrancaStatusDecisionReason,
} from '../mappers/status-precedence';
import { resolveMonotonicAsaasPaymentStatus } from '../mappers/asaas-snapshot-monotonicity';

export type PaymentStateSource = 'WEBHOOK' | 'RECONCILIATION' | 'MANUAL_VERIFY';

export type PaymentStateDecisionKind = 'APPLY' | 'NOOP' | 'RECONCILE' | 'MANUAL_REVIEW';

export type PaymentStateDecisionReason =
  | CobrancaStatusDecisionReason
  | 'EVENT_NOT_ALLOWED_FROM_STATE'
  | 'TERMINAL_STATE'
  | 'PROVIDER_SNAPSHOT_ONLY'
  | 'UNKNOWN_EVENT_REQUIRES_RECONCILIATION';

export type PaymentStateDecision = {
  kind: PaymentStateDecisionKind;
  previousLocalStatus: StatusCobranca;
  nextLocalStatus: StatusCobranca;
  previousProviderStatus: string | null;
  nextProviderStatus: string | null;
  reason: PaymentStateDecisionReason;
  eventName: string | null;
};

export type ChargeStateDecision = {
  kind: PaymentStateDecisionKind;
  previousLocalStatus: ChargeStatus;
  nextLocalStatus: ChargeStatus;
  previousProviderStatus: string | null;
  nextProviderStatus: string | null;
  reason: string;
  eventName: string | null;
};

const TERMINAL_COBRANCA = new Set<StatusCobranca>(['ESTORNADO', 'CANCELADO']);
const REFUND_EVENTS = new Set([
  'PAYMENT_REFUNDED',
  'PAYMENT_REFUND_REQUESTED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);
const CONFIRMATION_EVENTS = new Set([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_RECEIVED_IN_CASH',
  'PAYMENT_DUNNING_RECEIVED',
]);
const OPEN_EVENTS = new Set(['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_OVERDUE', 'PAYMENT_DUNNING_REQUESTED']);

function normalizeProviderStatus(value?: string | null): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function isRegularActiveStatus(status: StatusCobranca): boolean {
  return ['PENDENTE', 'A_VENCER', 'PROCESSANDO', 'ATRASADO'].includes(status);
}

function isAllowedCobrancaTransition(params: {
  current: StatusCobranca;
  next: StatusCobranca;
  eventName: string | null;
  previousProviderStatus?: string | null;
}): boolean {
  const { current, next, eventName, previousProviderStatus } = params;
  if (current === next) return true;

  if (eventName === 'PAYMENT_RECEIVED_IN_CASH_UNDONE') {
    return current === 'PAGO' && ['PENDENTE', 'A_VENCER', 'ATRASADO'].includes(next);
  }

  if (eventName === 'PAYMENT_RESTORED') {
    return ['CANCELADO', 'CANCELAMENTO_PENDENTE'].includes(current) && ['PENDENTE', 'A_VENCER'].includes(next);
  }

  if (eventName === 'PAYMENT_PARTIALLY_REFUNDED') {
    return current === 'PAGO' && next === 'ESTORNADO_PARCIAL';
  }

  if (REFUND_EVENTS.has(eventName ?? '')) {
    return !TERMINAL_COBRANCA.has(current) && ['ESTORNADO', 'ESTORNADO_PARCIAL'].includes(next);
  }

  if (eventName === 'PAYMENT_DELETED' || eventName === 'PAYMENT_CANCELED') {
    return !TERMINAL_COBRANCA.has(current) && next === 'CANCELADO';
  }

  if (CONFIRMATION_EVENTS.has(eventName ?? '')) {
    return (
      (isRegularActiveStatus(current) ||
        (current === 'ESTORNADO' && previousProviderStatus === 'AWAITING_CHARGEBACK_REVERSAL')) &&
      next === 'PAGO'
    );
  }

  if (eventName === 'PAYMENT_AWAITING_RISK_ANALYSIS') {
    return isRegularActiveStatus(current) && next === 'PROCESSANDO';
  }

  if (eventName === 'PAYMENT_OVERDUE' || eventName === 'PAYMENT_DUNNING_REQUESTED') {
    return isRegularActiveStatus(current) && next === 'ATRASADO';
  }

  if (OPEN_EVENTS.has(eventName ?? '')) {
    return isRegularActiveStatus(current) && ['PENDENTE', 'A_VENCER', 'PROCESSANDO', 'ATRASADO'].includes(next);
  }

  return false;
}

/**
 * Matriz canônica da cobrança acadêmica. A precedência antiga continua sendo
 * usada para calcular o candidato, mas a matriz explícita decide se a aresta
 * é válida para o evento recebido.
 */
export function decideCobrancaPaymentTransition(input: {
  currentLocalStatus: StatusCobranca;
  currentProviderStatus?: string | null;
  incomingProviderStatus?: string | null;
  eventName?: string | null;
  billingType?: string | null;
  dueDate?: Date | string | null;
  now?: Date;
  source: PaymentStateSource;
}): PaymentStateDecision {
  const eventName = input.eventName?.trim().toUpperCase() || null;
  const previousProviderStatus = normalizeProviderStatus(input.currentProviderStatus);
  const incomingProviderStatus = normalizeProviderStatus(input.incomingProviderStatus);
  const nextProviderStatus = resolveMonotonicAsaasPaymentStatus({
    currentAsaasStatus: previousProviderStatus,
    incoming: incomingProviderStatus,
    localCobrancaStatus: input.currentLocalStatus,
  });
  const computed = computeNextCobrancaStatus({
    currentStatus: input.currentLocalStatus,
    eventName: eventName ?? undefined,
    asaasPaymentStatus: incomingProviderStatus as never,
    billingType: input.billingType,
    dueDate: input.dueDate,
    now: input.now,
  });

  const isChargebackReversal =
    CONFIRMATION_EVENTS.has(eventName ?? '') &&
    input.currentLocalStatus === 'ESTORNADO' &&
    previousProviderStatus === 'AWAITING_CHARGEBACK_REVERSAL' &&
    ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(incomingProviderStatus ?? '');
  const candidateNextStatus: StatusCobranca = isChargebackReversal ? 'PAGO' : computed.nextStatus;

  if (candidateNextStatus === input.currentLocalStatus) {
    return {
      kind: eventName && OPEN_EVENTS.has(eventName) && TERMINAL_COBRANCA.has(input.currentLocalStatus)
        ? 'RECONCILE'
        : 'NOOP',
      previousLocalStatus: input.currentLocalStatus,
      nextLocalStatus: input.currentLocalStatus,
      previousProviderStatus,
      nextProviderStatus,
      reason: isChargebackReversal ? 'ASAAS_STATUS_APPLIED' : computed.decisionReason,
      eventName,
    };
  }

  if (isAllowedCobrancaTransition({
    current: input.currentLocalStatus,
    next: candidateNextStatus,
    eventName,
    previousProviderStatus,
  })) {
    return {
      kind: 'APPLY',
      previousLocalStatus: input.currentLocalStatus,
      nextLocalStatus: candidateNextStatus,
      previousProviderStatus,
      nextProviderStatus,
      reason: isChargebackReversal ? 'ASAAS_STATUS_APPLIED' : computed.decisionReason,
      eventName,
    };
  }

  return {
    kind: input.source === 'WEBHOOK' ? 'NOOP' : 'RECONCILE',
    previousLocalStatus: input.currentLocalStatus,
    nextLocalStatus: input.currentLocalStatus,
    previousProviderStatus,
    nextProviderStatus,
    reason: eventName && !OPEN_EVENTS.has(eventName)
      ? 'EVENT_NOT_ALLOWED_FROM_STATE'
      : computed.decisionReason === 'OUT_OF_ORDER_EVENT_IGNORED'
        ? computed.decisionReason
        : 'UNKNOWN_EVENT_REQUIRES_RECONCILIATION',
    eventName,
  };
}

export function decideChargePaymentTransition(input: {
  currentLocalStatus: ChargeStatus;
  currentProviderStatus?: string | null;
  incomingProviderStatus?: string | null;
  internalStatus: Parameters<typeof computeNextChargeStatus>[0]['internalStatus'];
  eventName?: string | null;
  source: PaymentStateSource;
}): ChargeStateDecision {
  const eventName = input.eventName?.trim().toUpperCase() || null;
  const previousProviderStatus = normalizeProviderStatus(input.currentProviderStatus);
  const nextProviderStatus = resolveMonotonicAsaasPaymentStatus({
    currentAsaasStatus: previousProviderStatus,
    incoming: normalizeProviderStatus(input.incomingProviderStatus),
    localChargeStatus: input.currentLocalStatus,
  });
  const computedNext = computeNextChargeStatus({
    currentStatus: input.currentLocalStatus,
    internalStatus: input.internalStatus,
    eventName,
  });
  const isChargebackReversal =
    input.currentLocalStatus === 'REFUNDED' &&
    input.currentProviderStatus?.trim().toUpperCase() === 'AWAITING_CHARGEBACK_REVERSAL' &&
    (input.internalStatus === 'CONFIRMED' || input.internalStatus === 'RECEIVED_IN_CASH');
  const next = isChargebackReversal ? 'PAID' : computedNext;
  if (next === input.currentLocalStatus) {
    return {
      kind: 'NOOP',
      previousLocalStatus: input.currentLocalStatus,
      nextLocalStatus: next,
      previousProviderStatus,
      nextProviderStatus,
      reason: 'STATUS_ALREADY_APPLIED',
      eventName,
    };
  }

  if (
    (isChargebackReversal && next === 'PAID') ||
    canApplyChargeStatusTransition({ current: input.currentLocalStatus, next, eventName })
  ) {
    return {
      kind: 'APPLY',
      previousLocalStatus: input.currentLocalStatus,
      nextLocalStatus: next,
      previousProviderStatus,
      nextProviderStatus,
      reason: 'ASAAS_STATUS_APPLIED',
      eventName,
    };
  }

  return {
    kind: input.source === 'WEBHOOK' ? 'NOOP' : 'RECONCILE',
    previousLocalStatus: input.currentLocalStatus,
    nextLocalStatus: input.currentLocalStatus,
    previousProviderStatus,
    nextProviderStatus,
    reason: 'OUT_OF_ORDER_EVENT_IGNORED',
    eventName,
  };
}

export function buildPaymentStateTransitionDedupeKey(input: {
  contaId: string;
  entityType: 'COBRANCA' | 'CHARGE';
  entityId: string;
  source: PaymentStateSource;
  sourceId: string;
}): string {
  return [input.contaId, input.entityType, input.entityId, input.source, input.sourceId].join(':');
}
