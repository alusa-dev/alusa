import { describe, expect, it } from 'vitest';

import { buildDeletedPaymentWebhookPayload } from '../deleted-payment-webhook';

describe('buildDeletedPaymentWebhookPayload', () => {
  it('preserva o contrato PAYMENT_DELETED e usa referência de fallback', () => {
    const payload = buildDeletedPaymentWebhookPayload({
      id: 'pay-1',
      value: 120,
      netValue: null,
      externalReference: null,
      deleted: true,
      subscription: null,
      installment: null,
      dueDate: null,
      paymentDate: null,
      clientPaymentDate: null,
      creditDate: null,
      estimatedCreditDate: null,
      originalValue: null,
      billingType: null,
    } as never, 'alusa:cobranca:c-1');

    expect(payload).toEqual({
      event: 'PAYMENT_DELETED',
      payment: expect.objectContaining({
        id: 'pay-1',
        status: 'DELETED',
        value: 120,
        netValue: 120,
        externalReference: 'alusa:cobranca:c-1',
        deleted: true,
      }),
    });
  });
});
