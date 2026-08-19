import { describe, expect, it } from 'vitest';

import { calculateParticipantPayment } from './events.service';

describe('event participant payment calculation', () => {
  it('sums a manual entry with Asaas installments', () => {
    const payment = calculateParticipantPayment(
      780,
      false,
      {
        status: 'RECEIVED',
        actualAmount: 180,
        refundedAmount: 0,
        asaasPaymentId: null,
      },
      [
        { status: 'RECEIVED', value: 200 },
        { status: 'RECEIVED', value: 200 },
        { status: 'OPEN', value: 200 },
      ],
    );

    expect(payment.totalPaid).toBe(580);
    expect(payment.percentPaid).toBeCloseTo(74.36, 2);
    expect(payment.status).toBe('EM_DIA');
  });

  it('marks the registration as paid when entry and all installments are received', () => {
    const payment = calculateParticipantPayment(
      780,
      false,
      { status: 'RECEIVED', actualAmount: 180, refundedAmount: 0, asaasPaymentId: null },
      [
        { status: 'RECEIVED', value: 200 },
        { status: 'RECEIVED', value: 200 },
        { status: 'RECEIVED', value: 200 },
      ],
    );

    expect(payment.totalPaid).toBe(780);
    expect(payment.status).toBe('QUITADO');
  });
});
