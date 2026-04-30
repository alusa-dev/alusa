/**
 * Terminal Statuses - Estados finais que não podem ser alterados
 *
 * Estados terminais representam o fim do ciclo de vida de uma cobrança.
 * Webhooks e operações manuais NÃO devem alterar estes estados.
 */

import type { StatusCobranca, ChargeStatus } from '@prisma/client';

/**
 * StatusCobranca terminais
 * Cobrança nesses estados não pode ter status alterado (exceto admin com forceOverride)
 */
export const TERMINAL_COBRANCA_STATUSES: readonly StatusCobranca[] = [
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
] as const;

/**
 * ChargeStatus terminais
 */
export const TERMINAL_CHARGE_STATUSES: readonly ChargeStatus[] = [
  'CANCELED',
  'REFUNDED',
] as const;

/**
 * Verifica se um StatusCobranca é terminal
 */
export function isTerminalCobrancaStatus(status: StatusCobranca): boolean {
  return (TERMINAL_COBRANCA_STATUSES as readonly string[]).includes(status);
}

/**
 * Verifica se um ChargeStatus é terminal
 */
export function isTerminalChargeStatus(status: ChargeStatus): boolean {
  return (TERMINAL_CHARGE_STATUSES as readonly string[]).includes(status);
}
