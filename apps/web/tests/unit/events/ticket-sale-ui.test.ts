import { describe, expect, it } from 'vitest';

import { getTicketSaleFinancialSummary } from '@/features/events/tickets/ticket-sale-ui';

describe('getTicketSaleFinancialSummary', () => {
  it('describes a partial refund and calculates gross, refunded, and net amounts', () => {
    expect(getTicketSaleFinancialSummary({
      status: 'PAID',
      totalAmount: 90,
      refundedAmount: 15,
      paymentStatus: 'REFUNDED',
    })).toEqual({
      label: 'Pago · estorno parcial',
      tone: 'info',
      grossAmount: 90,
      refundedAmount: 15,
      netAmount: 75,
      hasRefund: true,
    });
  });

  it('leaves the paid label available when there is no completed refund', () => {
    expect(getTicketSaleFinancialSummary({
      status: 'PAID',
      totalAmount: 90,
      refundedAmount: 0,
      paymentStatus: 'REFUND_IN_PROGRESS',
    })).toMatchObject({
      label: 'Pago · estorno em andamento',
      tone: 'info',
      netAmount: 90,
      hasRefund: false,
    });
  });

  it('does not present a full refund as partial or produce negative net revenue', () => {
    expect(getTicketSaleFinancialSummary({
      status: 'REFUNDED',
      totalAmount: 90,
      refundedAmount: 100,
      paymentStatus: 'REFUNDED',
    })).toMatchObject({
      label: null,
      grossAmount: 90,
      refundedAmount: 100,
      netAmount: 0,
      hasRefund: true,
    });
  });

  it('explains that tickets remain active when this row is fully refunded but still PAID', () => {
    expect(getTicketSaleFinancialSummary({
      status: 'PAID',
      totalAmount: 45,
      refundedAmount: 45,
      paymentStatus: 'PARTIALLY_REFUNDED',
    })).toEqual({
      label: 'Valor estornado · ingressos ativos',
      tone: 'info',
      grossAmount: 45,
      refundedAmount: 45,
      netAmount: 0,
      hasRefund: true,
    });
  });
});
