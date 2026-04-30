/**
 * Status Badge Mapper - Mapeamento para UI
 *
 * Converte StatusCobranca e ChargeStatus para configurações de Badge.
 * Usado em tabelas, cards e detalhes de cobrança/pagamento.
 */

import type { StatusCobranca, ChargeStatus } from '@prisma/client';

/**
 * Tipos de badge suportados pelo componente Badge
 * Compatível com @/components/ui/badge
 */
export type BadgeStatusType =
  | 'PENDING'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'CANCELED'
  | 'REFUNDED'
  | 'PROCESSANDO'
  | 'CANCELADO';

/**
 * Configuração completa de badge
 */
export interface StatusBadgeConfig {
  /** Tipo de badge para o componente */
  badgeType: BadgeStatusType;
  /** Label em português */
  label: string;
  /** Variante de cor */
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  /** Ícone opcional */
  icon?: string;
  /** Descrição para tooltip */
  description?: string;
}

/**
 * Mapeamento StatusCobranca → Badge Config
 */
const COBRANCA_STATUS_BADGE: Record<StatusCobranca, StatusBadgeConfig> = {
  PENDENTE: {
    badgeType: 'PENDING',
    label: 'Pendente',
    variant: 'warning',
    icon: '⏳',
    description: 'Aguardando pagamento',
  },
  A_VENCER: {
    badgeType: 'PENDING',
    label: 'A vencer',
    variant: 'info',
    icon: '📅',
    description: 'Cobrança com vencimento futuro',
  },
  PROCESSANDO: {
    badgeType: 'PROCESSANDO',
    label: 'Processando',
    variant: 'info',
    icon: '🔄',
    description: 'Pagamento em processamento/análise',
  },
  ATRASADO: {
    badgeType: 'OVERDUE',
    label: 'Atrasado',
    variant: 'danger',
    icon: '⚠️',
    description: 'Cobrança vencida',
  },
  PAGO: {
    badgeType: 'CONFIRMED',
    label: 'Pago',
    variant: 'success',
    icon: '✅',
    description: 'Pagamento confirmado',
  },
  CANCELAMENTO_PENDENTE: {
    badgeType: 'PROCESSANDO',
    label: 'Cancelando...',
    variant: 'warning',
    icon: '🔄',
    description: 'Aguardando confirmação de cancelamento',
  },
  CANCELADO: {
    badgeType: 'CANCELADO',
    label: 'Cancelado',
    variant: 'neutral',
    icon: '⛔',
    description: 'Cobrança cancelada',
  },
  ESTORNADO: {
    badgeType: 'REFUNDED',
    label: 'Estornado',
    variant: 'neutral',
    icon: '↩️',
    description: 'Pagamento estornado',
  },
  ESTORNADO_PARCIAL: {
    badgeType: 'REFUNDED',
    label: 'Estorno parcial',
    variant: 'neutral',
    icon: '↩️',
    description: 'Pagamento com estorno parcial',
  },
};

/**
 * Mapeamento ChargeStatus → Badge Config
 */
const CHARGE_STATUS_BADGE: Record<ChargeStatus, StatusBadgeConfig> = {
  CREATED: {
    badgeType: 'PENDING',
    label: 'Criada',
    variant: 'info',
    icon: '📝',
    description: 'Cobrança criada/rascunho',
  },
  PENDING_SYNC: {
    badgeType: 'PROCESSANDO',
    label: 'Sincronizando',
    variant: 'info',
    icon: '🔄',
    description: 'Aguardando confirmação do Asaas',
  },
  OPEN: {
    badgeType: 'PENDING',
    label: 'Aberta',
    variant: 'warning',
    icon: '⏳',
    description: 'Aguardando pagamento',
  },
  OVERDUE: {
    badgeType: 'OVERDUE',
    label: 'Vencida',
    variant: 'danger',
    icon: '⚠️',
    description: 'Cobrança vencida',
  },
  PAID: {
    badgeType: 'CONFIRMED',
    label: 'Paga',
    variant: 'success',
    icon: '✅',
    description: 'Pagamento confirmado',
  },
  CANCELED: {
    badgeType: 'CANCELED',
    label: 'Cancelada',
    variant: 'neutral',
    icon: '⛔',
    description: 'Cobrança cancelada',
  },
  REFUNDED: {
    badgeType: 'REFUNDED',
    label: 'Estornada',
    variant: 'neutral',
    icon: '↩️',
    description: 'Pagamento estornado',
  },
};

/**
 * Retorna configuração de badge para StatusCobranca
 */
export function getCobrancaStatusBadge(status: StatusCobranca): StatusBadgeConfig {
  return COBRANCA_STATUS_BADGE[status] ?? {
    badgeType: 'PENDING',
    label: status,
    variant: 'neutral',
  };
}

/**
 * Retorna configuração de badge para ChargeStatus
 */
export function getChargeStatusBadge(status: ChargeStatus): StatusBadgeConfig {
  return CHARGE_STATUS_BADGE[status] ?? {
    badgeType: 'PENDING',
    label: status,
    variant: 'neutral',
  };
}

/**
 * Retorna apenas o BadgeStatusType para uso direto no componente Badge
 * Aceita tanto StatusCobranca quanto ChargeStatus
 */
export function getUnifiedBadgeStatus(status: StatusCobranca | ChargeStatus | string): BadgeStatusType {
  // Tentar primeiro como StatusCobranca
  const cobrancaConfig = COBRANCA_STATUS_BADGE[status as StatusCobranca];
  if (cobrancaConfig) return cobrancaConfig.badgeType;

  // Tentar como ChargeStatus
  const chargeConfig = CHARGE_STATUS_BADGE[status as ChargeStatus];
  if (chargeConfig) return chargeConfig.badgeType;

  // Fallback para status legados/strings diretas
  const legacyMap: Record<string, BadgeStatusType> = {
    CONFIRMADO: 'CONFIRMED',
    ESTORNADO: 'REFUNDED',
  };

  return legacyMap[status] ?? 'PENDING';
}
