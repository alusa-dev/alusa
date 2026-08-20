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

  it('keeps zero manual payment as partial unless exemption is explicit', () => {
    const partial = calculateParticipantPayment(0, false, null, [], false);
    const exempt = calculateParticipantPayment(0, false, null, [], true);

    expect(partial.status).toBe('PARCIAL');
    expect(partial.percentPaid).toBe(0);
    expect(exempt.status).toBe('ISENTO');
    expect(exempt.percentPaid).toBe(100);
  });

  it('uses the net amount of manual payments after a refund', () => {
    const payment = calculateParticipantPayment(
      780,
      true,
      { status: 'RECEIVED', actualAmount: 925, refundedAmount: 725, asaasPaymentId: null },
      [],
      false,
      [
        { status: 'REFUNDED', amount: 725, refundedAmount: 725 },
        { status: 'RECEIVED', amount: 50, refundedAmount: 0 },
        { status: 'RECEIVED', amount: 150, refundedAmount: 0 },
      ],
    );

    expect(payment.totalPaid).toBe(925);
    expect(payment.netPaid).toBe(200);
    expect(payment.percentPaid).toBeCloseTo(25.64, 2);
    expect(payment.status).toBe('EM_DIA');
  });
});
