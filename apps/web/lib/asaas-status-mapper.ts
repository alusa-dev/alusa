import type { StatusCobranca } from '@prisma/client';
import type { PaymentStatus as AsaasPaymentStatus } from '@alusa/asaas';

export type { AsaasPaymentStatus };

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusBadgeConfig {
  label: string;
  variant: BadgeVariant;
  description?: string;
  icon?: string;
}

const FINAL_STATUSES: ReadonlySet<StatusCobranca> = new Set([
  'PAGO',
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
]);

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function calculateDynamicStatus(
  status: StatusCobranca,
  vencimento: Date,
): StatusCobranca {
  if (FINAL_STATUSES.has(status)) return status;
  if (status === 'PROCESSANDO') return status;

  const today = startOfDay(new Date());
  const due = startOfDay(vencimento);

  if (due.getTime() > today.getTime()) return 'A_VENCER';
  if (due.getTime() < today.getTime()) return 'ATRASADO';
  return 'PENDENTE';
}

export function getInternalStatusBadge(status: StatusCobranca): StatusBadgeConfig {
  const configs: Record<StatusCobranca, StatusBadgeConfig> = {
    A_VENCER: {
      label: 'A vencer',
      variant: 'info',
      description: 'Cobrança com vencimento futuro.',
      icon: '📅',
    },
    PENDENTE: {
      label: 'Pendente',
      variant: 'warning',
      description: 'Aguardando pagamento.',
      icon: '⏳',
    },
    PROCESSANDO: {
      label: 'Processando',
      variant: 'info',
      description: 'Pagamento em processamento/análise.',
      icon: '🔄',
    },
    PAGO: {
      label: 'Pago',
      variant: 'success',
      description: 'Pagamento confirmado.',
      icon: '✅',
    },
    ATRASADO: {
      label: 'Atrasado',
      variant: 'danger',
      description: 'Cobrança vencida.',
      icon: '⚠️',
    },
    CANCELAMENTO_PENDENTE: {
      label: 'Cancelando...',
      variant: 'warning',
      description: 'Aguardando confirmação de cancelamento.',
      icon: '🔄',
    },
    CANCELADO: {
      label: 'Cancelado',
      variant: 'neutral',
      description: 'Cobrança cancelada.',
      icon: '⛔',
    },
    ESTORNADO: {
      label: 'Estornado',
      variant: 'neutral',
      description: 'Pagamento estornado.',
      icon: '↩️',
    },
    ESTORNADO_PARCIAL: {
      label: 'Estorno parcial',
      variant: 'neutral',
      description: 'Pagamento com estorno parcial.',
      icon: '↩️',
    },
  };

  return configs[status] ?? { label: status, variant: 'neutral' };
}

export function getAsaasStatusBadge(status: AsaasPaymentStatus): StatusBadgeConfig {
  const configs: Partial<Record<AsaasPaymentStatus, StatusBadgeConfig>> = {
    PENDING: {
      label: 'Pendente',
      variant: 'warning',
      description: 'Aguardando pagamento.',
      icon: '⏳',
    },
    CONFIRMED: {
      label: 'Confirmado',
      variant: 'success',
      description: 'Pagamento confirmado.',
      icon: '✅',
    },
    RECEIVED: {
      label: 'Recebido',
      variant: 'success',
      description: 'Pagamento recebido.',
      icon: '✅',
    },
    OVERDUE: {
      label: 'Vencido',
      variant: 'danger',
      description: 'Cobrança vencida.',
      icon: '⚠️',
    },
    REFUNDED: {
      label: 'Reembolsado',
      variant: 'neutral',
      description: 'Pagamento reembolsado/estornado.',
      icon: '↩️',
    },
    DELETED: {
      label: 'Cancelado',
      variant: 'neutral',
      description: 'Pagamento cancelado/deletado.',
      icon: '⛔',
    },
  };

  return configs[status] ?? { label: status, variant: 'neutral' };
}
