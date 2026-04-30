/**
 * Precedência de status de pagamento/cobrança.
 *
 * Regra de progressão monotônica:
 * - Eventos de webhook podem chegar fora de ordem.
 * - O sistema NUNCA deve rebaixar um estado mais avançado para um menos avançado.
 * - Ex.: PAGO → PENDENTE é bloqueado; PENDENTE → PAGO é permitido.
 *
 * Valores maiores = estados mais avançados/finais.
 * Estados terminais (REFUNDED, CHARGEBACK, CANCELLED) têm precedência máxima
 * para evitar "ressuscitar" cobranças já encerradas.
 *
 * NOTA IMPORTANTE sobre PENDING do Asaas:
 * - O Asaas envia status=PENDING tanto para cobranças recém-criadas quanto
 *   para cobranças emitidas aguardando pagamento.
 * - Internamente, PENDENTE (5) é draft/rascunho e A_VENCER (10) é emitida.
 * - Ao processar webhook PAYMENT_CREATED com status PENDING, devemos:
 *   - Se current <= A_VENCER: manter/avançar para A_VENCER
 *   - Nunca rebaixar de A_VENCER para PENDENTE
 */

import type { StatusCobranca, ChargeStatus } from '@prisma/client';
import type { AsaasPaymentStatus } from '@alusa/asaas-gateway';
import type { PaymentStatus } from '@alusa/shared';
import { mapAsaasStatusToInternal } from './status-mapper';

// ─────────────────────────────────────────────────────────────────────────────
// StatusCobranca (tabela cobranca)
// ─────────────────────────────────────────────────────────────────────────────


const STATUS_COBRANCA_PRECEDENCE: Record<StatusCobranca, number> = {
  PENDENTE: 5,         // Estado inicial - cobrança criada/draft
  A_VENCER: 10,        // Emitida, vencimento futuro (equivale a PENDING no Asaas após emissão)
  PROCESSANDO: 15,     // Processando pagamento
  ATRASADO: 30,        // Passou o vencimento sem pagamento
  PAGO: 40,            // Pagamento confirmado
  // Estados intermediários de cancelamento
  CANCELAMENTO_PENDENTE: 80, // Aguardando confirmação de cancelamento
  // Estados terminais (não podem ser revertidos por webhook normal)
  ESTORNADO_PARCIAL: 85,
  ESTORNADO: 90,
  CANCELADO: 95,
};

/**
 * Retorna true se `next` é igual ou mais avançado que `current`.
 * Usado para decidir se o webhook deve atualizar o status da cobrança.
 */
export function canProgressCobrancaStatus(current: StatusCobranca, next: StatusCobranca): boolean {
  const currentPrecedence = STATUS_COBRANCA_PRECEDENCE[current] ?? 0;
  const nextPrecedence = STATUS_COBRANCA_PRECEDENCE[next] ?? 0;
  return nextPrecedence >= currentPrecedence;
}

/**
 * Retorna true se `next` representa uma regressão (rebaixamento) de status.
 */
export function isCobrancaStatusRegression(current: StatusCobranca, next: StatusCobranca): boolean {
  return !canProgressCobrancaStatus(current, next);
}

// ─────────────────────────────────────────────────────────────────────────────
// ChargeStatus (tabela charge)
// ─────────────────────────────────────────────────────────────────────────────

const CHARGE_STATUS_PRECEDENCE: Record<ChargeStatus, number> = {
  CREATED: 5,
  PENDING_SYNC: 7,
  OPEN: 10,
  OVERDUE: 30,
  PAID: 40,
  // Estados terminais
  REFUNDED: 90,
  CANCELED: 95,
};

/**
 * Retorna true se `next` é igual ou mais avançado que `current`.
 */
export function canProgressChargeStatus(current: ChargeStatus, next: ChargeStatus): boolean {
  if (
    current === 'PAID' &&
    (next === 'OPEN' || next === 'OVERDUE')
  ) {
    return false;
  }
  const currentPrecedence = CHARGE_STATUS_PRECEDENCE[current] ?? 0;
  const nextPrecedence = CHARGE_STATUS_PRECEDENCE[next] ?? 0;
  return nextPrecedence >= currentPrecedence;
}

export function canApplyChargeStatusTransition(params: {
  current: ChargeStatus;
  next: ChargeStatus;
  eventName?: string | null;
}): boolean {
  const { current, next, eventName } = params;

  if (
    eventName === 'PAYMENT_RECEIVED_IN_CASH_UNDONE' &&
    current === 'PAID' &&
    (next === 'OPEN' || next === 'OVERDUE')
  ) {
    return true;
  }

  // PAYMENT_RESTORED: permite CANCELED → OPEN
  if (
    eventName === 'PAYMENT_RESTORED' &&
    current === 'CANCELED' &&
    next === 'OPEN'
  ) {
    return true;
  }

  return canProgressChargeStatus(current, next);
}

/**
 * Retorna true se `next` representa uma regressão (rebaixamento) de status.
 */
export function isChargeStatusRegression(
  current: ChargeStatus,
  next: ChargeStatus,
  eventName?: string | null
): boolean {
  return !canApplyChargeStatusTransition({ current, next, eventName });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de diagnóstico
// ─────────────────────────────────────────────────────────────────────────────

export function getCobrancaPrecedence(status: StatusCobranca): number {
  return STATUS_COBRANCA_PRECEDENCE[status] ?? 0;
}

export function getChargePrecedence(status: ChargeStatus): number {
  return CHARGE_STATUS_PRECEDENCE[status] ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Função de cálculo de próximo status (evita regressão indevida)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula o próximo StatusCobranca considerando:
 * 1. O status atual da cobrança
 * 2. O status do pagamento no Asaas (payload.payment.status)
 * 3. O evento (para contexto)
 *
 * Regra chave: PENDING do Asaas em cobrança A_VENCER → mantém A_VENCER
 */
export type CobrancaStatusDecisionReason =
  | 'ASAAS_STATUS_APPLIED'
  | 'EVENT_FALLBACK_APPLIED'
  | 'OUT_OF_ORDER_EVENT_IGNORED'
  | 'REGRESSION_BLOCKED'
  | 'STATUS_ALREADY_APPLIED';

export function computeNextCobrancaStatus(params: {
  currentStatus: StatusCobranca;
  eventName?: string;
  asaasPaymentStatus?: AsaasPaymentStatus | null;
  billingType?: string | null;
  dueDate?: Date | string | null;
  paymentDate?: Date | string | null;
  now?: Date;
}): { nextStatus: StatusCobranca; decisionReason: CobrancaStatusDecisionReason } {
  const { currentStatus, eventName, asaasPaymentStatus, billingType, dueDate, now } = params;
  const nowDate = now ?? new Date();

  if (eventName === 'PAYMENT_PARTIALLY_REFUNDED') {
    if (currentStatus === 'ESTORNADO_PARCIAL') {
      return { nextStatus: currentStatus, decisionReason: 'STATUS_ALREADY_APPLIED' };
    }

    if (canProgressCobrancaStatus(currentStatus, 'ESTORNADO_PARCIAL')) {
      return { nextStatus: 'ESTORNADO_PARCIAL', decisionReason: 'EVENT_FALLBACK_APPLIED' };
    }

    return { nextStatus: currentStatus, decisionReason: 'REGRESSION_BLOCKED' };
  }

  const parsedDueDate = dueDate ? new Date(dueDate) : null;
  const hasAsaasStatus = typeof asaasPaymentStatus === 'string';
  let internalStatus = hasAsaasStatus ? mapAsaasStatusToInternal(asaasPaymentStatus as AsaasPaymentStatus) : null;
  const normalizedBillingType = typeof billingType === 'string' ? billingType.trim().toUpperCase() : '';
  const isCashBilling = normalizedBillingType === 'RECEIVED_IN_CASH';

  if (
    isCashBilling &&
    (internalStatus === null || internalStatus === 'PENDING') &&
    (eventName === 'PAYMENT_RECEIVED' || eventName === 'PAYMENT_CONFIRMED' || eventName === 'PAYMENT_RECEIVED_IN_CASH')
  ) {
    internalStatus = 'RECEIVED_IN_CASH';
  }

  // Alguns eventos críticos podem chegar com payload.status ainda "PENDING"
  // (janela de consistência eventual do provedor). Nesses casos, priorizamos o evento.
  if (internalStatus === 'PENDING' && eventName) {
    switch (eventName) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_DUNNING_RECEIVED':
        internalStatus = 'CONFIRMED';
        break;
      case 'PAYMENT_RECEIVED_IN_CASH':
        internalStatus = 'RECEIVED_IN_CASH';
        break;
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_REFUND_REQUESTED':
      case 'PAYMENT_REFUND_IN_PROGRESS':
        internalStatus = 'REFUNDED';
        break;
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE':
      case 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL':
        internalStatus = 'CHARGEBACK';
        break;
      case 'PAYMENT_CANCELED':
      case 'PAYMENT_DELETED':
        internalStatus = 'CANCELLED';
        break;
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_DUNNING_REQUESTED':
        internalStatus = 'OVERDUE';
        break;
      case 'PAYMENT_RESTORED':
        internalStatus = 'PENDING';
        break;
      default:
        break;
    }
  }

  // REGRA CRÍTICA: PAYMENT_DELETED sempre resulta em CANCELADO (estado terminal)
  // Isso evita cobranças "fantasmas" que aparecem abertas no ERP mas foram deletadas no Asaas
  if (eventName === 'PAYMENT_DELETED' || asaasPaymentStatus === 'DELETED') {
    const isAlreadyTerminal = ['CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL'].includes(currentStatus);
    if (isAlreadyTerminal) {
      return { nextStatus: currentStatus, decisionReason: 'STATUS_ALREADY_APPLIED' as const };
    }
    return { nextStatus: 'CANCELADO' as StatusCobranca, decisionReason: 'ASAAS_STATUS_APPLIED' as const };
  }

  let candidateStatus: StatusCobranca = currentStatus;
  let decisionReason: CobrancaStatusDecisionReason = 'STATUS_ALREADY_APPLIED';

  if (internalStatus) {
    switch (internalStatus) {
      case 'CONFIRMED':
        candidateStatus = 'PAGO';
        decisionReason = 'ASAAS_STATUS_APPLIED';
        break;
      case 'RECEIVED_IN_CASH':
        // Recebido em mãos também é considerado pago
        candidateStatus = 'PAGO';
        decisionReason = 'ASAAS_STATUS_APPLIED';
        break;
      case 'OVERDUE':
        candidateStatus = 'ATRASADO';
        decisionReason = 'ASAAS_STATUS_APPLIED';
        break;
      case 'REFUNDED':
        candidateStatus = 'ESTORNADO';
        decisionReason = 'ASAAS_STATUS_APPLIED';
        break;
      case 'CHARGEBACK':
        // Chargeback é tratado como estorno (terminal)
        candidateStatus = 'ESTORNADO';
        decisionReason = 'ASAAS_STATUS_APPLIED';
        break;
      case 'CANCELLED':
        candidateStatus = 'CANCELADO';
        decisionReason = 'ASAAS_STATUS_APPLIED';
        break;
      case 'PENDING':
      default: {
        if (parsedDueDate && parsedDueDate > nowDate) {
          candidateStatus = 'A_VENCER';
        } else if (parsedDueDate && parsedDueDate <= nowDate) {
          candidateStatus = 'PENDENTE';
        } else {
          candidateStatus = 'A_VENCER';
        }
        decisionReason = 'ASAAS_STATUS_APPLIED';
        break;
      }
    }
  } else if (eventName) {
    switch (eventName) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_RECEIVED_IN_CASH':
        candidateStatus = 'PAGO';
        decisionReason = 'EVENT_FALLBACK_APPLIED';
        break;
      case 'PAYMENT_RECEIVED_IN_CASH_UNDONE': {
        if (parsedDueDate && parsedDueDate > nowDate) {
          candidateStatus = 'A_VENCER';
        } else if (parsedDueDate && parsedDueDate <= nowDate) {
          candidateStatus = 'PENDENTE';
        } else {
          candidateStatus = 'A_VENCER';
        }
        decisionReason = 'EVENT_FALLBACK_APPLIED';
        break;
      }
      case 'PAYMENT_OVERDUE':
        candidateStatus = 'ATRASADO';
        decisionReason = 'EVENT_FALLBACK_APPLIED';
        break;
      case 'PAYMENT_DELETED':
      case 'PAYMENT_CANCELED':
        candidateStatus = 'CANCELADO';
        decisionReason = 'EVENT_FALLBACK_APPLIED';
        break;
      case 'PAYMENT_CREATED':
      default: {
        if (parsedDueDate && parsedDueDate > nowDate) {
          candidateStatus = 'A_VENCER';
        } else if (parsedDueDate && parsedDueDate <= nowDate) {
          candidateStatus = 'PENDENTE';
        } else {
          candidateStatus = 'A_VENCER';
        }
        decisionReason = 'EVENT_FALLBACK_APPLIED';
        break;
      }
    }
  }

  if (canProgressCobrancaStatus(currentStatus, candidateStatus)) {
    if (candidateStatus === currentStatus) {
      return { nextStatus: currentStatus, decisionReason: 'STATUS_ALREADY_APPLIED' };
    }
    return { nextStatus: candidateStatus, decisionReason };
  }

  if (
    eventName === 'PAYMENT_RECEIVED_IN_CASH_UNDONE' &&
    currentStatus === 'PAGO' &&
    (candidateStatus === 'PENDENTE' || candidateStatus === 'A_VENCER' || candidateStatus === 'ATRASADO')
  ) {
    return { nextStatus: candidateStatus, decisionReason };
  }

  // REGRA: PAYMENT_RESTORED permite voltar de CANCELADO para estado aberto
  if (
    eventName === 'PAYMENT_RESTORED' &&
    (currentStatus === 'CANCELADO' || currentStatus === 'CANCELAMENTO_PENDENTE') &&
    (candidateStatus === 'PENDENTE' || candidateStatus === 'A_VENCER')
  ) {
    return { nextStatus: candidateStatus, decisionReason };
  }

  // REGRA: Estados terminais (CANCELLED, REFUNDED, CHARGEBACK) NUNCA são ignorados
  // mesmo quando parecem "fora de ordem"
  const isTerminalEvent = 
    internalStatus === 'CANCELLED' ||
    internalStatus === 'REFUNDED' ||
    internalStatus === 'CHARGEBACK' ||
    eventName === 'PAYMENT_DELETED' ||
    eventName === 'PAYMENT_REFUNDED';

  if (isTerminalEvent) {
    // Eventos terminais forçam progressão para estado terminal
    // Isso garante que cobranças deletadas no Asaas sejam canceladas no ERP
    return { nextStatus: candidateStatus, decisionReason: 'ASAAS_STATUS_APPLIED' };
  }

  const isOutOfOrderExpected =
    internalStatus === 'PENDING' ||
    eventName === 'PAYMENT_CREATED';

  return {
    nextStatus: currentStatus,
    decisionReason: isOutOfOrderExpected ? 'OUT_OF_ORDER_EVENT_IGNORED' : 'REGRESSION_BLOCKED',
  };
}

/**
 * Calcula o próximo ChargeStatus com lógica similar
 * 
 * IMPORTANTE: Estados terminais (CANCELED, REFUNDED) não retrocedem
 */
export function computeNextChargeStatus(params: {
  currentStatus: ChargeStatus;
  internalStatus: PaymentStatus;
  eventName?: string | null;
}): ChargeStatus {
  const { currentStatus, internalStatus, eventName } = params;

  // Estados terminais nunca retrocedem (exceto CANCELED via PAYMENT_RESTORED)
  const isCurrentTerminal = ['CANCELED', 'REFUNDED'].includes(currentStatus);
  if (isCurrentTerminal) {
    if (currentStatus === 'CANCELED' && eventName === 'PAYMENT_RESTORED') {
      return 'OPEN';
    }
    return currentStatus;
  }

  switch (internalStatus) {
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return 'PAID';
    case 'OVERDUE':
      return 'OVERDUE';
    case 'REFUNDED':
    case 'CHARGEBACK':
      return 'REFUNDED';
    case 'CANCELLED':
      return 'CANCELED';
    case 'PENDING':
    default:
      if (eventName === 'PAYMENT_RECEIVED_IN_CASH_UNDONE' && currentStatus === 'PAID') {
        return 'OPEN';
      }
      // PENDING: se já estamos em OPEN ou acima, manter
      if (getChargePrecedence(currentStatus) >= getChargePrecedence('OPEN')) {
        return currentStatus;
      }
      return 'OPEN';
  }
}

/**
 * Resolve o status interno de pagamento a partir de:
 * - payment.status (quando disponível)
 * - payment.billingType (caso RECEIVE_IN_CASH com status ainda PENDING)
 * - eventName (fallback para cenários de consistência eventual do Asaas)
 */
export function resolveInternalPaymentStatus(params: {
  eventName?: string | null;
  asaasPaymentStatus?: AsaasPaymentStatus | string | null;
  billingType?: string | null;
  deleted?: boolean | null;
}): PaymentStatus {
  if (params.deleted === true) {
    return 'CANCELLED';
  }
  const eventName = typeof params.eventName === 'string' ? params.eventName : '';
  const normalizedStatus =
    typeof params.asaasPaymentStatus === 'string'
      ? params.asaasPaymentStatus.trim().toUpperCase()
      : '';
  const normalizedBillingType =
    typeof params.billingType === 'string' ? params.billingType.trim().toUpperCase() : '';
  const isCashBilling = normalizedBillingType === 'RECEIVED_IN_CASH';

  let internalStatus = mapAsaasStatusToInternal(normalizedStatus || 'PENDING');

  if (
    isCashBilling &&
    (normalizedStatus === '' || normalizedStatus === 'PENDING') &&
    (eventName === 'PAYMENT_RECEIVED_IN_CASH' ||
      eventName === 'PAYMENT_RECEIVED' ||
      eventName === 'PAYMENT_CONFIRMED')
  ) {
    return 'RECEIVED_IN_CASH';
  }

  if (normalizedStatus === '' || normalizedStatus === 'PENDING') {
    switch (eventName) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_DUNNING_RECEIVED':
        internalStatus = 'CONFIRMED';
        break;
      case 'PAYMENT_RECEIVED_IN_CASH':
        internalStatus = 'RECEIVED_IN_CASH';
        break;
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_REFUND_REQUESTED':
      case 'PAYMENT_REFUND_IN_PROGRESS':
        internalStatus = 'REFUNDED';
        break;
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE':
      case 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL':
        internalStatus = 'CHARGEBACK';
        break;
      case 'PAYMENT_CANCELED':
      case 'PAYMENT_DELETED':
        internalStatus = 'CANCELLED';
        break;
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_DUNNING_REQUESTED':
        internalStatus = 'OVERDUE';
        break;
      case 'PAYMENT_RESTORED':
        internalStatus = 'PENDING';
        break;
      default:
        internalStatus = 'PENDING';
        break;
    }
  }

  return internalStatus;
}
