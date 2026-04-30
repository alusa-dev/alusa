/**
 * Mapeamento Asaas → Status Interno
 *
 * Única fonte de verdade para converter status do Asaas
 * para StatusCobranca (tabela cobranca) e ChargeStatus (tabela charge).
 *
 * @see https://docs.asaas.com/reference/listar-cobranças
 */

import type { StatusCobranca, ChargeStatus } from '@prisma/client';

/**
 * Status de pagamento do Asaas (todos os valores possíveis)
 */
export type AsaasPaymentStatus =
  | 'PENDING'
  | 'AWAITING_RISK_ANALYSIS'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'REFUND_IN_PROGRESS'
  | 'REFUND_REQUESTED'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_RECEIVED'
  | 'DUNNING_REQUESTED'
  | 'RECEIVED_IN_CASH'
  | 'DELETED';

/**
 * Mapeamento Asaas → StatusCobranca (tabela cobranca)
 *
 * REGRA CRÍTICA:
 * - DELETED → CANCELADO (sempre terminal)
 * - RECEIVED/CONFIRMED/DUNNING_RECEIVED → PAGO
 * - OVERDUE/DUNNING_REQUESTED → ATRASADO
 * - REFUNDED/* → ESTORNADO
 * - CHARGEBACK/* → ESTORNADO (tratamos como terminal)
 * - PENDING/AWAITING_RISK_ANALYSIS → depende de dueDate
 */
export const ASAAS_TO_COBRANCA_MAP: Record<AsaasPaymentStatus, StatusCobranca> = {
  // Pendentes (status inicial, dependerá de dueDate para A_VENCER ou PENDENTE)
  PENDING: 'PENDENTE',
  AWAITING_RISK_ANALYSIS: 'PROCESSANDO',

  // Pagos/Confirmados
  RECEIVED: 'PAGO',
  CONFIRMED: 'PAGO',
  DUNNING_RECEIVED: 'PAGO',
  RECEIVED_IN_CASH: 'PAGO',

  // Vencidos
  OVERDUE: 'ATRASADO',
  DUNNING_REQUESTED: 'ATRASADO',

  // Estornos
  REFUNDED: 'ESTORNADO',
  REFUND_IN_PROGRESS: 'ESTORNADO',
  REFUND_REQUESTED: 'ESTORNADO',

  // Chargebacks (terminais)
  CHARGEBACK_REQUESTED: 'ESTORNADO',
  CHARGEBACK_DISPUTE: 'ESTORNADO',
  AWAITING_CHARGEBACK_REVERSAL: 'ESTORNADO',

  // Cancelados (terminal)
  DELETED: 'CANCELADO',
};

/**
 * Mapeamento Asaas → ChargeStatus (tabela charge)
 */
export const ASAAS_TO_CHARGE_MAP: Record<AsaasPaymentStatus, ChargeStatus> = {
  PENDING: 'OPEN',
  AWAITING_RISK_ANALYSIS: 'OPEN',
  RECEIVED: 'PAID',
  CONFIRMED: 'PAID',
  DUNNING_RECEIVED: 'PAID',
  RECEIVED_IN_CASH: 'PAID',
  OVERDUE: 'OVERDUE',
  DUNNING_REQUESTED: 'OVERDUE',
  REFUNDED: 'REFUNDED',
  REFUND_IN_PROGRESS: 'REFUNDED',
  REFUND_REQUESTED: 'REFUNDED',
  CHARGEBACK_REQUESTED: 'REFUNDED',
  CHARGEBACK_DISPUTE: 'REFUNDED',
  AWAITING_CHARGEBACK_REVERSAL: 'REFUNDED',
  DELETED: 'CANCELED',
};

/**
 * Converte status do Asaas para StatusCobranca.
 *
 * @param asaasStatus - Status vindo do Asaas (payment.status ou webhook)
 * @param options.dueDate - Data de vencimento (para diferenciar PENDENTE vs A_VENCER)
 * @param options.now - Data atual (para testes)
 * @returns StatusCobranca correspondente
 *
 * @example
 * mapAsaasPaymentStatusToCobranca('RECEIVED') // 'PAGO'
 * mapAsaasPaymentStatusToCobranca('PENDING', { dueDate: futureDate }) // 'A_VENCER'
 * mapAsaasPaymentStatusToCobranca('PENDING', { dueDate: pastDate }) // 'PENDENTE'
 */
export function mapAsaasPaymentStatusToCobranca(
  asaasStatus: AsaasPaymentStatus | string,
  options?: { dueDate?: Date | string | null; now?: Date },
): StatusCobranca {
  const status = asaasStatus as AsaasPaymentStatus;
  const mapped = ASAAS_TO_COBRANCA_MAP[status];

  // Status desconhecido → PENDENTE como fallback
  if (!mapped) {
    console.warn(`[charge-status] Status desconhecido do Asaas: ${asaasStatus}, usando PENDENTE`);
    return 'PENDENTE';
  }

  // Para PENDING, diferenciar A_VENCER vs PENDENTE baseado em dueDate
  if (status === 'PENDING' && options?.dueDate) {
    const now = options.now ?? new Date();
    const dueDate = new Date(options.dueDate);

    // Normalizar para comparar apenas datas (sem hora)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

    if (dueDateStart > todayStart) {
      return 'A_VENCER';
    }
  }

  return mapped;
}

/**
 * Converte status do Asaas para ChargeStatus (tabela charge standalone).
 *
 * @param asaasStatus - Status vindo do Asaas
 * @returns ChargeStatus correspondente
 */
export function mapAsaasPaymentStatusToCharge(asaasStatus: AsaasPaymentStatus | string): ChargeStatus {
  const status = asaasStatus as AsaasPaymentStatus;
  const mapped = ASAAS_TO_CHARGE_MAP[status];

  if (!mapped) {
    console.warn(`[charge-status] Status desconhecido do Asaas: ${asaasStatus}, usando OPEN`);
    return 'OPEN';
  }

  return mapped;
}
