import { describe, expect, it } from 'vitest';

import {
  buildEventReportRevenueRows,
  formatEventReportDateKey,
} from '../../../features/events/reports/event-report-view-model';

describe('buildEventReportRevenueRows', () => {
  it('uses committed ticket revenue for source totals and reconciles pending amounts with the headline', () => {
    const rows = buildEventReportRevenueRows({
      registrationCommitted: 100,
      registrationReceived: 70,
      registrationRefunded: 10,
      ticketCommittedRevenue: 150,
      ticketReceivedNet: 120,
      ticketPendingRevenue: 20,
      ticketRefunded: 30,
      otherRevenueExpected: 40,
      otherRevenueReceived: 35,
      otherRevenueRefunded: 0,
    });

    expect(rows).toContainEqual({
      id: 'tickets', source: 'Bilheteria', planned: 150, received: 120, pending: 30, refunded: 30,
    });
    expect(rows.reduce((total, row) => total + row.planned, 0)).toBe(290);
    expect(rows.reduce((total, row) => total + row.pending, 0)).toBe(65);
  });

  it('formats a civil chart day without shifting it to the browser timezone', () => {
    expect(formatEventReportDateKey('2026-10-14')).toBe('14/10/2026');
  });
});
