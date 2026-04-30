import type { StatusCobranca } from '@prisma/client';

export function mapAsaasPaymentStatusToCobrancaStatus(status: string): StatusCobranca {
  const mapping: Record<string, StatusCobranca> = {
    PENDING: 'PENDENTE',
    AWAITING_RISK_ANALYSIS: 'PROCESSANDO',
    RECEIVED: 'PAGO',
    CONFIRMED: 'PAGO',
    RECEIVED_IN_CASH: 'PAGO',
    OVERDUE: 'ATRASADO',
    DUNNING_REQUESTED: 'ATRASADO',
    DUNNING_RECEIVED: 'PAGO',
    REFUNDED: 'ESTORNADO',
    REFUND_REQUESTED: 'ESTORNADO',
    REFUND_IN_PROGRESS: 'ESTORNADO',
    CHARGEBACK_REQUESTED: 'ESTORNADO',
    CHARGEBACK_DISPUTE: 'ESTORNADO',
    AWAITING_CHARGEBACK_REVERSAL: 'ESTORNADO',
    DELETED: 'CANCELADO',
  };

  return mapping[status] ?? 'PENDENTE';
}
