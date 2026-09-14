export type MobileBillingCategory =
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'AWAITING_PAYMENT'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'IGNORED';

export type BillingStatusInput = {
  localStatus: string;
  asaasStatus?: string | null;
  liquidacaoStatus?: string | null;
  dueDate?: Date | null;
  startOfToday: Date;
};

function normalize(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

/**
 * Normalizes the provider snapshot and local state into the four user-facing
 * buckets used by the mobile billing summary.
 */
export function resolveMobileBillingCategory(input: BillingStatusInput): MobileBillingCategory {
  const asaasStatus = normalize(input.asaasStatus);

  switch (asaasStatus) {
    case 'CANCELED':
    case 'CANCELLED':
    case 'DELETED':
      return 'CANCELLED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
      return 'RECEIVED';
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'OVERDUE':
      return 'OVERDUE';
    case 'PENDING':
      return input.dueDate && input.dueDate < input.startOfToday
        ? 'OVERDUE'
        : 'AWAITING_PAYMENT';
    default:
      break;
  }

  if (input.localStatus === 'PAGO' || input.localStatus === 'PAID') {
    return input.liquidacaoStatus === 'PENDENTE' ? 'CONFIRMED' : 'RECEIVED';
  }

  if (['CANCELADO', 'CANCELADA', 'CANCELED', 'CANCELLED'].includes(input.localStatus)) {
    return 'CANCELLED';
  }

  if (['ESTORNADO', 'ESTORNADO_PARCIAL', 'REFUNDED'].includes(input.localStatus)) {
    return 'REFUNDED';
  }

  if (
    input.localStatus === 'ATRASADO' ||
    input.localStatus === 'OVERDUE' ||
    Boolean(input.dueDate && input.dueDate < input.startOfToday)
  ) {
    return 'OVERDUE';
  }

  if (['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'CREATED', 'PENDING_SYNC', 'OPEN'].includes(input.localStatus)) {
    return 'AWAITING_PAYMENT';
  }

  return 'IGNORED';
}

export function numberFromFinanceDecimal(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export function roundFinanceCurrency(value: number): number {
  return Number(value.toFixed(2));
}
