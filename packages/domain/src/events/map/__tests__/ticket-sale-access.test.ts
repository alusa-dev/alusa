import { describe, expect, it } from 'vitest';

import { buildStaffSaleTicketsUrl, canPrintStaffSaleTickets } from '../ticket-sale-access';

describe('ticket-sale-access', () => {
  it('permite ingressos apenas para vendas pagas ou cortesia', () => {
    expect(canPrintStaffSaleTickets('PAID')).toBe(true);
    expect(canPrintStaffSaleTickets('COMPLIMENTARY')).toBe(true);
    expect(canPrintStaffSaleTickets('PENDING')).toBe(false);
    expect(canPrintStaffSaleTickets('REFUNDED')).toBe(false);
    expect(canPrintStaffSaleTickets('CANCELLED')).toBe(false);
  });

  it('monta url de ingressos somente quando elegível', () => {
    expect(buildStaffSaleTicketsUrl('sale_1', 'PAID', 2)).toBe('/api/events/ticket-sales/sale_1/tickets');
    expect(buildStaffSaleTicketsUrl('sale_1', 'REFUNDED', 2)).toBeNull();
    expect(buildStaffSaleTicketsUrl('sale_1', 'PAID', 0)).toBeNull();
  });
});
