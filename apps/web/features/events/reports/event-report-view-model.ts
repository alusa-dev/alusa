import type { EventReportDetailDTO } from '../events-service';

export type EventReportRevenueRow = {
  id: string;
  source: string;
  planned: number;
  received: number;
  pending: number;
  refunded: number;
};

export function formatEventReportDateKey(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

type EventReportRevenueTotals = Pick<EventReportDetailDTO['totals'],
  | 'registrationCommitted' | 'registrationReceived' | 'registrationRefunded'
  | 'ticketCommittedRevenue' | 'ticketReceivedNet' | 'ticketPendingRevenue' | 'ticketRefunded'
  | 'otherRevenueExpected' | 'otherRevenueReceived' | 'otherRevenueRefunded'
>;

export function buildEventReportRevenueRows(totals: EventReportRevenueTotals): EventReportRevenueRow[] {
  return [
    {
      id: 'registrations', source: 'Inscrições', planned: totals.registrationCommitted,
      received: totals.registrationReceived,
      pending: Math.max(totals.registrationCommitted - totals.registrationReceived, 0),
      refunded: totals.registrationRefunded,
    },
    {
      id: 'tickets', source: 'Bilheteria', planned: totals.ticketCommittedRevenue,
      received: totals.ticketReceivedNet,
      pending: Math.max(totals.ticketCommittedRevenue - totals.ticketReceivedNet, 0),
      refunded: totals.ticketRefunded,
    },
    {
      id: 'other', source: 'Outras receitas', planned: totals.otherRevenueExpected,
      received: totals.otherRevenueReceived,
      pending: Math.max(totals.otherRevenueExpected - totals.otherRevenueReceived, 0),
      refunded: totals.otherRevenueRefunded,
    },
  ];
}
