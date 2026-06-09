/**
 * Charge Status Guard - Progressão Monotônica para Rotas Manuais
 *
 * Este módulo fornece funções para aplicar a mesma lógica de progressão
 * monotônica usada nos webhooks às rotas manuais, garantindo consistência.
 *
 * ADR: Estados financeiros nunca regridem, independentemente da origem.
 */

import type { StatusCobranca } from '@prisma/client';
import {
  canProgressCobrancaStatus,
  canProgressChargeStatus,
  getCobrancaPrecedence,
  getChargePrecedence,
} from '../mappers/status-precedence';
import { evaluatePaymentActionPolicy, toLegacyChargeActions } from '../policies';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type ChargeStatusTransitionResult =
  | { allowed: true; from: StatusCobranca; to: StatusCobranca }
  | { allowed: false; from: StatusCobranca; to: StatusCobranca; reason: string };

export type StatusUpdateOrigin = 'WEBHOOK' | 'MANUAL' | 'SYNC' | 'SYSTEM';

export interface ApplyStatusOptions {
  currentStatus: StatusCobranca;
  nextStatus: StatusCobranca;
  origin: StatusUpdateOrigin;
  /** Se true, força a atualização mesmo com regressão (usar com cautela) */
  forceOverride?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status terminais (não podem ser alterados por operações normais)
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES: readonly StatusCobranca[] = [
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
] as const;

const INTERMEDIATE_STATUSES: readonly StatusCobranca[] = [
  'CANCELAMENTO_PENDENTE',
] as const;

export function isTerminalStatus(status: StatusCobranca): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isIntermediateStatus(status: StatusCobranca): boolean {
  return INTERMEDIATE_STATUSES.includes(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validação de transição de status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica se uma transição de status é permitida.
 * Aplica a mesma lógica de progressão monotônica usada nos webhooks.
 */
export function validateChargeStatusTransition(
  currentStatus: StatusCobranca,
  nextStatus: StatusCobranca,
): ChargeStatusTransitionResult {
  // Mesmo status = não precisa mudar, mas é "permitido"
  if (currentStatus === nextStatus) {
    return { allowed: true, from: currentStatus, to: nextStatus };
  }

  // Status terminal não pode ser alterado (exceto por forceOverride)
  if (isTerminalStatus(currentStatus)) {
    return {
      allowed: false,
      from: currentStatus,
      to: nextStatus,
      reason: `Status terminal "${currentStatus}" não pode ser alterado`,
    };
  }

  // Verificar progressão monotônica
  if (!canProgressCobrancaStatus(currentStatus, nextStatus)) {
    return {
      allowed: false,
      from: currentStatus,
      to: nextStatus,
      reason: `Regressão de status bloqueada: "${currentStatus}" (${getCobrancaPrecedence(currentStatus)}) → "${nextStatus}" (${getCobrancaPrecedence(nextStatus)})`,
    };
  }

  return { allowed: true, from: currentStatus, to: nextStatus };
}

/**
 * Aplica status com validação de progressão monotônica.
 * Retorna o status que deve ser usado (pode ser o atual se transição inválida).
 */
export function applyChargeStatusWithMonotonicity(
  options: ApplyStatusOptions,
): { status: StatusCobranca; changed: boolean; blocked: boolean; reason?: string } {
  const { currentStatus, nextStatus, origin, forceOverride = false } = options;

  // Mesmo status = nada a fazer
  if (currentStatus === nextStatus) {
    return { status: currentStatus, changed: false, blocked: false };
  }

  // Se forceOverride, permitir qualquer transição (usar com cautela)
  if (forceOverride) {
    console.warn('⚠️ Force override aplicado para transição de status:', {
      from: currentStatus,
      to: nextStatus,
      origin,
    });
    return { status: nextStatus, changed: true, blocked: false };
  }

  const result = validateChargeStatusTransition(currentStatus, nextStatus);

  if (!result.allowed) {
    console.warn('⚠️ Transição de status bloqueada:', {
      from: currentStatus,
      to: nextStatus,
      origin,
      reason: result.reason,
    });
    return {
      status: currentStatus,
      changed: false,
      blocked: true,
      reason: result.reason,
    };
  }

  return { status: nextStatus, changed: true, blocked: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ações permitidas por status (para UI)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ações que podem ser executadas em uma cobrança
 */
export type ChargeAction =
  | 'RESEND_NOTIFICATION' // Reenviar cobrança (WhatsApp/email/SMS)
  | 'CONFIRM_CASH_PAYMENT' // Confirmar recebimento em dinheiro
  | 'UNDO_CASH_PAYMENT' // Desfazer recebimento em dinheiro
  | 'CANCEL' // Cancelar/remover cobrança
  | 'VIEW_INVOICE' // Visualizar fatura
  | 'REFUND' // Estornar pagamento
  | 'EDIT'; // Editar cobrança (valor, vencimento, etc.)

/**
 * Retorna as ações permitidas para um determinado status de cobrança.
 * A UI deve usar isso para mostrar/ocultar opções do menu "Mais ações".
 *
 * @param status - Status atual da cobrança
 * @param options - Opções adicionais para contexto
 * @param options.wasReceivedInCash - Indica se a cobrança foi recebida em dinheiro
 */
export function getAllowedActionsByChargeStatus(
  status: StatusCobranca,
  options?: { wasReceivedInCash?: boolean },
): ChargeAction[] {
  const policy = evaluatePaymentActionPolicy({
    entityType: 'COBRANCA',
    origin: 'ACADEMIC',
    localStatus: status,
    hasAsaasPaymentId: true,
    hasInvoiceUrl: true,
    wasReceivedInCash: options?.wasReceivedInCash,
  });
  const actions = toLegacyChargeActions(policy) as ChargeAction[];

  if (['A_VENCER', 'PENDENTE'].includes(status) && !actions.includes('CONFIRM_CASH_PAYMENT')) {
    return [...actions, 'CONFIRM_CASH_PAYMENT'];
  }

  if (status === 'ATRASADO') {
    return [...actions, 'CONFIRM_CASH_PAYMENT'];
  }

  if (status === 'CANCELAMENTO_PENDENTE') {
    return [];
  }

  return actions;
}

/**
 * Verifica se uma ação específica é permitida para um status
 */
export function isActionAllowed(
  status: StatusCobranca,
  action: ChargeAction,
  options?: { wasReceivedInCash?: boolean },
): boolean {
  return getAllowedActionsByChargeStatus(status, options).includes(action);
}

/**
 * Mapa de labels amigáveis para as ações
 */
export const CHARGE_ACTION_LABELS: Record<ChargeAction, string> = {
  RESEND_NOTIFICATION: 'Reenviar cobrança',
  CONFIRM_CASH_PAYMENT: 'Confirmar recebimento',
  UNDO_CASH_PAYMENT: 'Desfazer recebimento',
  CANCEL: 'Cancelar cobrança',
  VIEW_INVOICE: 'Visualizar fatura',
  REFUND: 'Estornar pagamento',
  EDIT: 'Editar cobrança',
};

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports para conveniência
// ─────────────────────────────────────────────────────────────────────────────

export {
  canProgressCobrancaStatus,
  canProgressChargeStatus,
  getCobrancaPrecedence,
  getChargePrecedence,
};
