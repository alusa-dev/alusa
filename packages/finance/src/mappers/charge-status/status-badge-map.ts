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
    label: 'Cancelamento pendente',
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

const LEGACY_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmado',
  CONFIRMADO: 'Confirmado',
  RECEIVED: 'Recebido',
  RECEBIDO: 'Recebido',
  PENDING: 'Pendente',
  OVERDUE: 'Atrasado',
  CANCELED: 'Cancelado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Estornado',
  REFUND_REQUESTED: 'Reembolso solicitado',
  FAILED: 'Falha no pagamento',
  EXPIRED: 'Expirado',
  EXPIRADO: 'Expirado',
  CREATED: 'Criada',
  OPEN: 'Aberta',
  PAID: 'Paga',
  MANUAL: 'Pago manualmente',
  RECEIVED_IN_CASH: 'Pago em dinheiro',
  CONCLUIDO: 'Concluído',
  AGUARDANDO: 'Aguardando',
};

function humanizeStatusToken(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .split('_')
    .map((word, index) => {
      if (index > 0 && ['a', 'de', 'da', 'do', 'em', 'no', 'na', 'e'].includes(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Rótulo legível em português para qualquer status de cobrança/pagamento conhecido.
 * Preferir este helper em listagens em vez de exibir o enum bruto (ex.: A_VENCER).
 */
export function getStatusLabel(status: string): string {
  const normalized = status?.trim().toUpperCase() ?? '';
  if (!normalized) return '';

  const cobrancaConfig = COBRANCA_STATUS_BADGE[normalized as StatusCobranca];
  if (cobrancaConfig) return cobrancaConfig.label;

  const chargeConfig = CHARGE_STATUS_BADGE[normalized as ChargeStatus];
  if (chargeConfig) return chargeConfig.label;

  if (LEGACY_STATUS_LABELS[normalized]) return LEGACY_STATUS_LABELS[normalized];

  return humanizeStatusToken(normalized);
}

export type StatusBadgeUiVariant = 'success' | 'warning' | 'destructive' | 'info' | 'neutral';

/**
 * Label + variante de cor para o componente Badge da UI.
 */
export function getStatusBadgePresentation(status: string): {
  label: string;
  variant: StatusBadgeUiVariant;
} {
  const normalized = status?.trim().toUpperCase() ?? '';
  const variantMap: Record<StatusBadgeConfig['variant'], StatusBadgeUiVariant> = {
    success: 'success',
    warning: 'warning',
    danger: 'destructive',
    info: 'info',
    neutral: 'neutral',
  };

  const cobrancaConfig = COBRANCA_STATUS_BADGE[normalized as StatusCobranca];
  if (cobrancaConfig) {
    return { label: cobrancaConfig.label, variant: variantMap[cobrancaConfig.variant] };
  }

  const chargeConfig = CHARGE_STATUS_BADGE[normalized as ChargeStatus];
  if (chargeConfig) {
    return { label: chargeConfig.label, variant: variantMap[chargeConfig.variant] };
  }

  const unified = getUnifiedBadgeStatus(normalized);
  const unifiedVariant: Record<BadgeStatusType, StatusBadgeUiVariant> = {
    CONFIRMED: 'success',
    PENDING: 'warning',
    OVERDUE: 'destructive',
    CANCELED: 'neutral',
    CANCELADO: 'neutral',
    REFUNDED: 'neutral',
    PROCESSANDO: 'info',
  };

  return {
    label: getStatusLabel(normalized),
    variant: unifiedVariant[unified] ?? 'neutral',
  };
}
