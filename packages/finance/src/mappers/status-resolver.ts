/**
 * StatusResolver unificado para UI.
 *
 * Centraliza a lógica de exibição de badges e labels para status de cobrança.
 * Todas as telas devem usar este resolver para garantir consistência.
 */

import { PAYMENT_STATUSES } from '@alusa/shared';
import type { PaymentStatus } from '@alusa/shared';
import type { LiquidacaoStatus } from './liquidacao-resolver';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'secondary' | 'outline';

export interface StatusBadgeConfig {
  variant: BadgeVariant;
  label: string;
  description?: string;
}

/**
 * Configuração de badge UI por status de pagamento.
 */
export function getPaymentStatusBadge(status: PaymentStatus): StatusBadgeConfig {
  const configs: Record<PaymentStatus, StatusBadgeConfig> = {
    PENDING: { 
      variant: 'warning', 
      label: 'Pendente',
      description: 'Aguardando pagamento',
    },
    CONFIRMED: { 
      variant: 'success', 
      label: 'Confirmado',
      description: 'Pagamento confirmado',
    },
    OVERDUE: { 
      variant: 'destructive', 
      label: 'Vencido',
      description: 'Cobrança vencida sem pagamento',
    },
    REFUNDED: { 
      variant: 'secondary', 
      label: 'Estornado',
      description: 'Pagamento estornado',
    },
    CANCELLED: { 
      variant: 'secondary', 
      label: 'Cancelado',
      description: 'Cobrança cancelada',
    },
    CHARGEBACK: { 
      variant: 'destructive', 
      label: 'Chargeback',
      description: 'Disputa de pagamento em andamento',
    },
    RECEIVED_IN_CASH: { 
      variant: 'outline', 
      label: 'Recebido em mãos',
      description: 'Recebido fora do gateway',
    },
  };

  return configs[status] || { variant: 'default', label: status };
}

/**
 * Configuração de badge UI por status de liquidação.
 */
export function getLiquidacaoStatusBadge(status: LiquidacaoStatus): StatusBadgeConfig {
  const configs: Record<LiquidacaoStatus, StatusBadgeConfig> = {
    NAO_APLICAVEL: {
      variant: 'secondary',
      label: 'N/A',
      description: 'Liquidação não aplicável',
    },
    PENDENTE: {
      variant: 'warning',
      label: 'Pendente',
      description: 'Aguardando crédito na conta',
    },
    DISPONIVEL: {
      variant: 'success',
      label: 'Disponível',
      description: 'Saldo creditado na conta',
    },
  };

  return configs[status];
}

/**
 * Configuração de badge por status de cobrança (StatusCobranca do Prisma).
 */
export function getCobrancaStatusBadge(status: string): StatusBadgeConfig {
  const configs: Record<string, StatusBadgeConfig> = {
    A_VENCER: {
      variant: 'default',
      label: 'A vencer',
      description: 'Vencimento futuro',
    },
    PENDENTE: {
      variant: 'warning',
      label: 'Pendente',
      description: 'Aguardando pagamento',
    },
    PROCESSANDO: {
      variant: 'outline',
      label: 'Processando',
      description: 'Pagamento em análise',
    },
    PAGO: {
      variant: 'success',
      label: 'Pago',
      description: 'Pagamento confirmado',
    },
    ATRASADO: {
      variant: 'destructive',
      label: 'Atrasado',
      description: 'Vencido sem pagamento',
    },
    CANCELAMENTO_PENDENTE: {
      variant: 'secondary',
      label: 'Canc. pendente',
      description: 'Aguardando confirmação de cancelamento',
    },
    CANCELADO: {
      variant: 'secondary',
      label: 'Cancelado',
      description: 'Cobrança cancelada',
    },
    ESTORNADO: {
      variant: 'secondary',
      label: 'Estornado',
      description: 'Pagamento estornado',
    },
    ESTORNADO_PARCIAL: {
      variant: 'secondary',
      label: 'Estorno parcial',
      description: 'Parte do pagamento estornado',
    },
  };

  return configs[status] || { variant: 'default', label: status };
}

/**
 * Configuração de badge por status de charge (ChargeStatus do Prisma).
 */
export function getChargeStatusBadge(status: string): StatusBadgeConfig {
  const configs: Record<string, StatusBadgeConfig> = {
    CREATED: {
      variant: 'default',
      label: 'Criada',
      description: 'Cobrança criada',
    },
    PENDING_SYNC: {
      variant: 'outline',
      label: 'Sincronizando',
      description: 'Aguardando confirmação do Asaas',
    },
    OPEN: {
      variant: 'warning',
      label: 'Aberta',
      description: 'Aguardando pagamento',
    },
    PAID: {
      variant: 'success',
      label: 'Pago',
      description: 'Pagamento confirmado',
    },
    OVERDUE: {
      variant: 'destructive',
      label: 'Vencido',
      description: 'Vencido sem pagamento',
    },
    CANCELED: {
      variant: 'secondary',
      label: 'Cancelado',
      description: 'Cobrança cancelada',
    },
    REFUNDED: {
      variant: 'secondary',
      label: 'Estornado',
      description: 'Pagamento estornado',
    },
  };

  return configs[status] || { variant: 'default', label: status };
}

/** Status terminais */
const TERMINAL_STATUSES: readonly PaymentStatus[] = [
  PAYMENT_STATUSES.REFUNDED,
  PAYMENT_STATUSES.CANCELLED,
  PAYMENT_STATUSES.CHARGEBACK,
] as const;

/** Status de pagamento recebido */
const PAID_STATUS_LIST: readonly PaymentStatus[] = [
  PAYMENT_STATUSES.CONFIRMED,
  PAYMENT_STATUSES.RECEIVED_IN_CASH,
] as const;

/** Status de dívida/pendência */
const DEBT_STATUS_LIST: readonly PaymentStatus[] = [
  PAYMENT_STATUSES.PENDING,
  PAYMENT_STATUSES.OVERDUE,
] as const;

/**
 * Verifica se o status representa um estado terminal (não pode mudar).
 */
export function isTerminalStatus(status: PaymentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Verifica se o status representa pagamento recebido.
 */
export function isPaidStatus(status: PaymentStatus): boolean {
  return PAID_STATUS_LIST.includes(status);
}

/**
 * Verifica se o status representa pendência/atraso.
 */
export function isDebtStatus(status: PaymentStatus): boolean {
  return DEBT_STATUS_LIST.includes(status);
}
