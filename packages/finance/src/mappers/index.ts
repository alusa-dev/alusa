/**
 * Mappers - Índice de exportação
 *
 * Centraliza todos os mappers de status, liquidação e configurações de UI.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Charge Status (FONTE ÚNICA DE VERDADE para mapeamento Asaas → interno)
// ─────────────────────────────────────────────────────────────────────────────
export {
  mapAsaasPaymentStatusToCobranca,
  mapAsaasPaymentStatusToCharge,
  ASAAS_TO_COBRANCA_MAP,
  ASAAS_TO_CHARGE_MAP,
  getUnifiedBadgeStatus,
  isTerminalCobrancaStatus,
  isTerminalChargeStatus,
  TERMINAL_COBRANCA_STATUSES,
  TERMINAL_CHARGE_STATUSES,
} from './charge-status';
export type { BadgeStatusType } from './charge-status';
// Re-export com alias para evitar conflito com status-resolver
export { getCobrancaStatusBadge as getCobrancaBadgeConfig, getChargeStatusBadge as getChargeBadgeConfig } from './charge-status';
export type { StatusBadgeConfig as ChargeBadgeConfig } from './charge-status';

// Legacy status mapping (manter compatibilidade)
export { mapAsaasStatusToInternal } from './status-mapper';
export { getStatusBadgeConfig } from './status-mapper';

// Status precedence (anti-regressão)
export {
  canProgressCobrancaStatus,
  isCobrancaStatusRegression,
  canProgressChargeStatus,
  canApplyChargeStatusTransition,
  isChargeStatusRegression,
  getCobrancaPrecedence,
  getChargePrecedence,
  computeNextCobrancaStatus,
  computeNextChargeStatus,
} from './status-precedence';
export type { CobrancaStatusDecisionReason } from './status-precedence';

// Status resolver (UI badges)
export {
  getPaymentStatusBadge,
  getLiquidacaoStatusBadge,
  getCobrancaStatusBadge,
  getChargeStatusBadge,
  isTerminalStatus,
  isPaidStatus,
  isDebtStatus,
} from './status-resolver';
export type { BadgeVariant, StatusBadgeConfig } from './status-resolver';

// Liquidação resolver
export {
  resolveLiquidacaoStatus,
  isReceivedInCash,
  isAvailableInAsaas,
  getEstimatedAvailableDate,
} from './liquidacao-resolver';
export type { LiquidacaoStatus, LiquidacaoResolverInput } from './liquidacao-resolver';
export { resolveLiquidacaoFromAsaasPayment } from './liquidacao-from-asaas';
export type { ResolveLiquidacaoFromAsaasInput } from './liquidacao-from-asaas';
export { resolveCobrancaDisplayStatus, isCobrancaStatusTerminal } from './cobranca-display-status';
export type { CobrancaDisplayStatus } from './cobranca-display-status';

// Domain mappers
export * from './installments.mapper';
export * from './invoices.mapper';
export * from './subscriptions.mapper';
export * from './transfers.mapper';
export * from './ledger.mapper';
