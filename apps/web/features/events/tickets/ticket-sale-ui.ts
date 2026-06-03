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
    RESERVED: 'info',
    PENDING: 'warning',
    PAID: 'success',
    CANCELLED: 'danger',
    REFUNDED: 'neutral',
    COMPLIMENTARY: 'info',
  };

  return tones[status];
}

export function getTicketPaymentMethodLabel(sale: TicketSaleDTO) {
  if (sale.paymentMethodLabel) return sale.paymentMethodLabel;
  if (!sale.paymentMethod) return 'Checkout público';
  return EVENT_PAYMENT_METHOD_LABELS[sale.paymentMethod as keyof typeof EVENT_PAYMENT_METHOD_LABELS] ?? sale.paymentMethod;
}
