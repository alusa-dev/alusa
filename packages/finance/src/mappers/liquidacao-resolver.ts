/**
 * Resolver de status de liquidação (saldo disponível).
 *
 * Regras:
 * - NAO_APLICAVEL: cobrança não paga, cancelada ou estornada
 * - PENDENTE: pago/confirmado, mas creditDate ainda no futuro
 * - DISPONIVEL: pago/confirmado e creditDate <= hoje
 *
 * RECEIVED_IN_CASH:
 * - Tratado como "recebido fora do Asaas"
 * - liquidacaoStatus = NAO_APLICAVEL (não soma no saldo Asaas)
 * - Exibido separado no balanço (Caixa/Recebido em mãos)
 */

import { PAYMENT_STATUSES } from '@alusa/shared';
import type { PaymentStatus } from '@alusa/shared';

export type LiquidacaoStatus = 'NAO_APLICAVEL' | 'PENDENTE' | 'DISPONIVEL';

export interface LiquidacaoResolverInput {
  /** Status interno normalizado */
  internalStatus: PaymentStatus;
  /** Data de crédito (quando o valor será/foi creditado) */
  creditDate?: Date | string | null;
  /** Data de pagamento (quando foi pago) */
  paymentDate?: Date | string | null;
  /** Data de referência (default: hoje) */
  referenceDate?: Date;
}

/**
 * Calcula o status de liquidação baseado no status de pagamento e data de crédito.
 */
export function resolveLiquidacaoStatus(input: LiquidacaoResolverInput): LiquidacaoStatus {
  const { internalStatus, creditDate, referenceDate } = input;
  const now = referenceDate ?? new Date();

  // RECEIVED_IN_CASH: recebido fora do Asaas, não entra no saldo
  if (internalStatus === PAYMENT_STATUSES.RECEIVED_IN_CASH) {
    return 'NAO_APLICAVEL';
  }

  // Somente status "pago" têm liquidação
  if (internalStatus !== PAYMENT_STATUSES.CONFIRMED) {
    return 'NAO_APLICAVEL';
  }

  // Se não temos creditDate, assumimos PENDENTE (aguardando info do Asaas)
  if (!creditDate) {
    return 'PENDENTE';
  }

  const parsedCreditDate = typeof creditDate === 'string' ? new Date(creditDate) : creditDate;

  // creditDate no futuro = PENDENTE
  // creditDate <= hoje = DISPONIVEL
  if (parsedCreditDate > now) {
    return 'PENDENTE';
  }

  return 'DISPONIVEL';
}

/**
 * Verifica se o pagamento foi recebido em dinheiro (fora do Asaas).
 * Usado para separar no balanço.
 */
export function isReceivedInCash(internalStatus: PaymentStatus): boolean {
  return internalStatus === PAYMENT_STATUSES.RECEIVED_IN_CASH;
}

/**
 * Verifica se o pagamento representa saldo disponível no Asaas.
 */
export function isAvailableInAsaas(liquidacaoStatus: LiquidacaoStatus): boolean {
  return liquidacaoStatus === 'DISPONIVEL';
}

/**
 * Retorna a data estimada de disponibilidade do saldo.
 */
export function getEstimatedAvailableDate(creditDate?: Date | string | null): Date | null {
  if (!creditDate) return null;
  return typeof creditDate === 'string' ? new Date(creditDate) : creditDate;
}
