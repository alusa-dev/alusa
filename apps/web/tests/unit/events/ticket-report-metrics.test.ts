import { describe, expect, it } from 'vitest';

import { getTicketReportMetrics } from '../../../features/events/tickets/ticket-report-metrics';

describe('getTicketReportMetrics', () => {
  it('uses net paid revenue and excludes cancelled or refunded sales from sold tickets', () => {
    const metrics = getTicketReportMetrics([
      { status: 'PAID', quantity: 2, totalAmount: 100, refundedAmount: 25 },
      { status: 'PENDING', quantity: 2, totalAmount: 60, refundedAmount: 0 },
      { status: 'RESERVED', quantity: 1, totalAmount: 20, refundedAmount: 0 },
      { status: 'COMPLIMENTARY', quantity: 2, totalAmount: 0, refundedAmount: 0 },
      { status: 'CANCELLED', quantity: 3, totalAmount: 90, refundedAmount: 0 },
      { status: 'REFUNDED', quantity: 4, totalAmount: 120, refundedAmount: 120 },
    ]);

    expect(metrics).toEqual({ revenue: 75, pending: 80, sold: 2, complimentary: 2 });
  });
});
