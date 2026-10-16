import {
  EVENT_PAYMENT_METHOD_LABELS,
  EVENT_TICKET_SALE_STATUS_LABELS,
} from '@alusa/shared';

import type { TicketSaleDTO } from '../events-service';
import type { EventSoftBadgeTone } from '../shared/EventSoftBadge';

export const EXTENDED_TICKET_SALE_STATUS_LABELS: Record<TicketSaleDTO['status'], string> = {
  ...EVENT_TICKET_SALE_STATUS_LABELS,
  RESERVED: 'Reservado',
};

export function getTicketSaleTone(status: TicketSaleDTO['status']): EventSoftBadgeTone {
  const tones: Record<TicketSaleDTO['status'], EventSoftBadgeTone> = {
    RESERVED: 'warning',
    PENDING: 'warning',
    PAID: 'success',
    CANCELLED: 'neutral',
    REFUNDED: 'info',
    COMPLIMENTARY: 'info',
  };

  return tones[status];
}

export type TicketSaleFinancialSummary = {
  label: string | null;
  tone: EventSoftBadgeTone;
  grossAmount: number;
  refundedAmount: number;
  netAmount: number;
  hasRefund: boolean;
};

/**
 * Keeps ticket validity/status separate from the payment's refund state. An
 * order-level partial refund can fully refund one row while its tickets stay
 * active; this only describes financial amounts for administrative views.
 */
export function getTicketSaleFinancialSummary(sale: Pick<TicketSaleDTO, 'status' | 'totalAmount' | 'refundedAmount' | 'paymentStatus'>): TicketSaleFinancialSummary {
  const grossAmount = Math.max(Number(sale.totalAmount) || 0, 0);
  const refundedAmount = Math.max(Number(sale.refundedAmount) || 0, 0);
  const netAmount = Math.max(grossAmount - refundedAmount, 0);
  const isPartialRefund = refundedAmount > 0 && refundedAmount < grossAmount;
  const amountFullyRefundedButTicketsActive = grossAmount > 0
    && refundedAmount >= grossAmount
    && sale.status === 'PAID';
  const refundPending = ['REFUND_IN_PROGRESS', 'REFUND_REQUESTED', 'PAYMENT_REFUND_IN_PROGRESS']
    .includes((sale.paymentStatus ?? '').trim().toUpperCase());

  return {
    label: isPartialRefund && sale.status === 'PAID'
      ? 'Pago · estorno parcial'
      : amountFullyRefundedButTicketsActive
        ? 'Valor estornado · ingressos ativos'
      : refundPending && sale.status === 'PAID'
        ? 'Pago · estorno em andamento'
        : null,
    tone: isPartialRefund || amountFullyRefundedButTicketsActive || refundPending ? 'info' : 'success',
    grossAmount,
    refundedAmount,
    netAmount,
    hasRefund: refundedAmount > 0,
  };
}

export function getTicketPaymentMethodLabel(sale: TicketSaleDTO) {
  if (sale.paymentMethodLabel) return sale.paymentMethodLabel;
  if (!sale.paymentMethod) return 'Checkout público';
  return EVENT_PAYMENT_METHOD_LABELS[sale.paymentMethod as keyof typeof EVENT_PAYMENT_METHOD_LABELS] ?? sale.paymentMethod;
}
