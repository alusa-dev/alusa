/**
 * Status Mapping - Mapeamento canônico de status Asaas → Alusa
 * 
 * ADR: Estados financeiros NUNCA são inferidos localmente.
 * Toda mudança de estado vem exclusivamente via webhook do Asaas.
 * 
 * Este módulo centraliza:
 * 1. Mapeamento de status Asaas → status interno
 * 2. Regras de precedência para evitar regressão
 * 3. Validação de transições de estado
 */

import type { StatusCobranca, ChargeStatus, LiquidacaoStatus } from '@prisma/client';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Status de pagamento do Asaas (enum oficial)
 * @see https://docs.asaas.com/reference/listar-cobran%C3%A7as
 */
export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'DELETED';

/**
 * Status interno normalizado (simplificado)
 */
export type InternalPaymentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'CHARGEBACK'
  | 'RECEIVED_IN_CASH';

// ═══════════════════════════════════════════════════════════════════════════
// STATUS MAPPING - Asaas → Interno
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mapeamento oficial de status Asaas → status interno
 */
const ASAAS_TO_INTERNAL_STATUS: Record<AsaasPaymentStatus, InternalPaymentStatus> = {
  // Pendentes
  PENDING: 'PENDING',
  AWAITING_RISK_ANALYSIS: 'PENDING',
  
  // Pagos/Confirmados
  RECEIVED: 'CONFIRMED',
  CONFIRMED: 'CONFIRMED',
  DUNNING_RECEIVED: 'CONFIRMED', // Recuperado via régua
  
  // Recebido em dinheiro (fora do Asaas)
  RECEIVED_IN_CASH: 'RECEIVED_IN_CASH',
  
  // Vencidos
  OVERDUE: 'OVERDUE',
  DUNNING_REQUESTED: 'OVERDUE', // Em régua de cobrança
  
  // Estornos
  REFUNDED: 'REFUNDED',
  REFUND_IN_PROGRESS: 'REFUNDED',
  REFUND_REQUESTED: 'REFUNDED',
  
  // Chargeback (todas as fases)
  CHARGEBACK_REQUESTED: 'CHARGEBACK',
  CHARGEBACK_DISPUTE: 'CHARGEBACK',
  AWAITING_CHARGEBACK_REVERSAL: 'CHARGEBACK',
  
  // Cancelados/Deletados
  DELETED: 'CANCELLED',
};

/**
 * Mapeamento de status interno → StatusCobranca (Prisma)
 */
const INTERNAL_TO_COBRANCA_STATUS: Record<InternalPaymentStatus, StatusCobranca> = {
  PENDING: 'PENDENTE',
  CONFIRMED: 'PAGO',
  OVERDUE: 'ATRASADO',
  REFUNDED: 'ESTORNADO',
  CANCELLED: 'CANCELADO',
  CHARGEBACK: 'ESTORNADO', // Chargeback é tratado como estorno
  RECEIVED_IN_CASH: 'PAGO', // Recebido em mãos é pago
};

/**
 * Mapeamento de status interno → ChargeStatus (Prisma)
 */
const INTERNAL_TO_CHARGE_STATUS: Record<InternalPaymentStatus, ChargeStatus> = {
  PENDING: 'OPEN',
  CONFIRMED: 'PAID',
  OVERDUE: 'OVERDUE',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELED',
  CHARGEBACK: 'REFUNDED',
  RECEIVED_IN_CASH: 'PAID',
};

// ═══════════════════════════════════════════════════════════════════════════
// PRECEDENCE - Ordem de prioridade para evitar regressão
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Precedência de status interno (maior = mais prioritário)
 * Status mais "finais" têm maior precedência
 */
const INTERNAL_STATUS_PRECEDENCE: Record<InternalPaymentStatus, number> = {
  PENDING: 10,
  OVERDUE: 20,
  CONFIRMED: 80,
  RECEIVED_IN_CASH: 80,
  REFUNDED: 90,
  CHARGEBACK: 95,
  CANCELLED: 100,
};

/**
 * Precedência de StatusCobranca (Prisma)
 */
const COBRANCA_STATUS_PRECEDENCE: Record<StatusCobranca, number> = {
  A_VENCER: 5,
  PENDENTE: 10,
  PROCESSANDO: 15,
  ATRASADO: 20,
  PAGO: 80,
  CANCELAMENTO_PENDENTE: 85,
  ESTORNADO: 90,
  ESTORNADO_PARCIAL: 90,
  CANCELADO: 100,
};

/**
 * Precedência de ChargeStatus (Prisma)
 */
const CHARGE_STATUS_PRECEDENCE: Record<ChargeStatus, number> = {
  CREATED: 5,
  PENDING_SYNC: 7,
  OPEN: 10,
  OVERDUE: 20,
  PAID: 80,
  REFUNDED: 90,
  CANCELED: 100,
};

// ═══════════════════════════════════════════════════════════════════════════
// MAPPERS - Funções de conversão
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mapeia status Asaas → status interno normalizado
 */
export function mapAsaasToInternalStatus(asaasStatus: string | null | undefined): InternalPaymentStatus {
  if (!asaasStatus) return 'PENDING';
  
  const normalized = asaasStatus.trim().toUpperCase() as AsaasPaymentStatus;
  return ASAAS_TO_INTERNAL_STATUS[normalized] ?? 'PENDING';
}

/**
 * Mapeia status Asaas → StatusCobranca (Prisma)
 */
export function mapAsaasToCobrancaStatus(asaasStatus: string | null | undefined): StatusCobranca {
  const internal = mapAsaasToInternalStatus(asaasStatus);
  return INTERNAL_TO_COBRANCA_STATUS[internal];
}

/**
 * Mapeia status Asaas → ChargeStatus (Prisma)
 */
export function mapAsaasToChargeStatus(asaasStatus: string | null | undefined): ChargeStatus {
  const internal = mapAsaasToInternalStatus(asaasStatus);
  return INTERNAL_TO_CHARGE_STATUS[internal];
}

/**
 * Mapeia status interno → StatusCobranca
 */
export function mapInternalToCobrancaStatus(internal: InternalPaymentStatus): StatusCobranca {
  return INTERNAL_TO_COBRANCA_STATUS[internal];
}

/**
 * Mapeia status interno → ChargeStatus
 */
export function mapInternalToChargeStatus(internal: InternalPaymentStatus): ChargeStatus {
  return INTERNAL_TO_CHARGE_STATUS[internal];
}

// ═══════════════════════════════════════════════════════════════════════════
// PRECEDENCE CHECKS - Verificações de transição
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se o novo status tem precedência sobre o atual
 * Retorna true se o novo status pode substituir o atual
 */
export function canProgressInternalStatus(
  currentStatus: InternalPaymentStatus,
  newStatus: InternalPaymentStatus
): boolean {
  return INTERNAL_STATUS_PRECEDENCE[newStatus] >= INTERNAL_STATUS_PRECEDENCE[currentStatus];
}

/**
 * Verifica se o novo StatusCobranca tem precedência sobre o atual
 */
export function canProgressCobrancaStatus(
  currentStatus: StatusCobranca,
  newStatus: StatusCobranca
): boolean {
  return COBRANCA_STATUS_PRECEDENCE[newStatus] >= COBRANCA_STATUS_PRECEDENCE[currentStatus];
}

/**
 * Verifica se o novo ChargeStatus tem precedência sobre o atual
 */
export function canProgressChargeStatus(
  currentStatus: ChargeStatus,
  newStatus: ChargeStatus
): boolean {
  return CHARGE_STATUS_PRECEDENCE[newStatus] >= CHARGE_STATUS_PRECEDENCE[currentStatus];
}

/**
 * Calcula o próximo status considerando precedência
 * Retorna o status com maior precedência
 */
export function computeNextCobrancaStatus(
  currentStatus: StatusCobranca,
  proposedStatus: StatusCobranca
): StatusCobranca {
  return canProgressCobrancaStatus(currentStatus, proposedStatus) ? proposedStatus : currentStatus;
}

/**
 * Calcula o próximo ChargeStatus considerando precedência
 */
export function computeNextChargeStatus(
  currentStatus: ChargeStatus,
  proposedStatus: ChargeStatus
): ChargeStatus {
  return canProgressChargeStatus(currentStatus, proposedStatus) ? proposedStatus : currentStatus;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDAÇÃO STATUS - Baseado em creditDate
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula o status de liquidação baseado no status Asaas e creditDate
 */
export function computeLiquidacaoStatus(params: {
  asaasStatus: string | null | undefined;
  creditDate: string | null | undefined;
}): LiquidacaoStatus {
  const { asaasStatus, creditDate } = params;
  const internal = mapAsaasToInternalStatus(asaasStatus);

  // Status que não geram liquidação
  if (['PENDING', 'OVERDUE', 'CANCELLED', 'REFUNDED', 'CHARGEBACK'].includes(internal)) {
    return 'NAO_APLICAVEL';
  }

  // Recebido em mãos: disponível imediatamente
  if (internal === 'RECEIVED_IN_CASH') {
    return 'DISPONIVEL';
  }

  // CONFIRMED: verificar creditDate
  if (internal === 'CONFIRMED') {
    if (!creditDate) return 'PENDENTE';
    
    const today = new Date().toISOString().split('T')[0];
    return creditDate <= today ? 'DISPONIVEL' : 'PENDENTE';
  }

  return 'NAO_APLICAVEL';
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se o status representa pagamento confirmado
 */
export function isPaidStatus(asaasStatus: string | null | undefined): boolean {
  const internal = mapAsaasToInternalStatus(asaasStatus);
  return internal === 'CONFIRMED' || internal === 'RECEIVED_IN_CASH';
}

/**
 * Verifica se o status representa cobrança ativa (não finalizada)
 */
export function isActiveStatus(asaasStatus: string | null | undefined): boolean {
  const internal = mapAsaasToInternalStatus(asaasStatus);
  return internal === 'PENDING' || internal === 'OVERDUE';
}

/**
 * Verifica se o status é terminal (não pode mudar)
 */
export function isTerminalStatus(asaasStatus: string | null | undefined): boolean {
  const internal = mapAsaasToInternalStatus(asaasStatus);
  return ['CANCELLED', 'REFUNDED', 'CHARGEBACK'].includes(internal);
}

/**
 * Retorna todos os status Asaas que mapeiam para um status interno
 */
export function getAsaasStatusesFor(internal: InternalPaymentStatus): AsaasPaymentStatus[] {
  return Object.entries(ASAAS_TO_INTERNAL_STATUS)
    .filter(([, v]) => v === internal)
    .map(([k]) => k as AsaasPaymentStatus);
}
