import type { PaymentHistoryCategory } from './categories';

export function resolvePaymentHistoryDetailHref(item: {
  sourceKind: string;
  sourceId: string;
  category: PaymentHistoryCategory;
  eventId?: string | null;
}): string {
  if (item.sourceKind === 'sale') return `/vendas/${item.sourceId}`;

  if (
    item.sourceKind.startsWith('event') ||
    item.category === 'EVENTOS'
  ) {
    if (item.eventId) return `/events/${item.eventId}`;
    return '/events';
  }

  return `/cobrancas/${item.sourceId}`;
}
