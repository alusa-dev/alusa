import type { PaymentStatus as AsaasPaymentStatus } from '@alusa/asaas';
import type { PaymentStatus } from '@alusa/shared';

/**
 * Mapeia status do Asaas para status interno normalizado.
 * Todos os status documentados do Asaas são mapeados aqui.
 * Usa string literals para evitar problemas de módulo cached (HMR/stale build).
 * @see https://docs.asaas.com/reference/listar-cobranças
 */
export function mapAsaasStatusToInternal(asaasStatus: AsaasPaymentStatus | string): PaymentStatus {
  const normalized = typeof asaasStatus === 'string'
    ? asaasStatus.trim().toUpperCase()
    : String(asaasStatus ?? '').trim().toUpperCase();

  if (!normalized) return 'PENDING';

  const mapping: Record<string, PaymentStatus> = {
    // Pendentes
    PENDING: 'PENDING',
    AWAITING_RISK_ANALYSIS: 'PENDING',
    
    // Pagos/Confirmados
    RECEIVED: 'CONFIRMED',
    CONFIRMED: 'CONFIRMED',
    DUNNING_RECEIVED: 'CONFIRMED',
    
    // Recebido em dinheiro (fora do Asaas)
    RECEIVED_IN_CASH: 'RECEIVED_IN_CASH',
    
    // Vencidos
    OVERDUE: 'OVERDUE',
    DUNNING_REQUESTED: 'OVERDUE',
    
    // Estornos
    REFUNDED: 'REFUNDED',
    REFUND_IN_PROGRESS: 'REFUNDED',
    REFUND_REQUESTED: 'REFUNDED',
    
    // Chargeback (todas as fases)
    CHARGEBACK_REQUESTED: 'CHARGEBACK',
    CHARGEBACK_DISPUTE: 'CHARGEBACK',
    AWAITING_CHARGEBACK_REVERSAL: 'CHARGEBACK',
    
    // Cancelados
    DELETED: 'CANCELLED',
  };

  return mapping[normalized] || 'PENDING';
}

/**
 * Configuração de badge UI por status
 * @deprecated Use getPaymentStatusBadge de status-resolver.ts
 */
export function getStatusBadgeConfig(status: PaymentStatus): {
  variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' | 'outline';
  label: string;
} {
  const configs: Record<PaymentStatus, ReturnType<typeof getStatusBadgeConfig>> = {
    PENDING: { variant: 'warning', label: 'Pendente' },
    CONFIRMED: { variant: 'success', label: 'Confirmado' },
    OVERDUE: { variant: 'destructive', label: 'Vencido' },
    REFUNDED: { variant: 'secondary', label: 'Reembolsado' },
    CANCELLED: { variant: 'secondary', label: 'Cancelado' },
    CHARGEBACK: { variant: 'destructive', label: 'Chargeback' },
    RECEIVED_IN_CASH: { variant: 'outline', label: 'Recebido em mãos' },
  };

  return configs[status] || { variant: 'default', label: status };
}
