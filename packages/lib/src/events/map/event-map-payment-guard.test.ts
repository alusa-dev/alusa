import { describe, expect, it } from 'vitest';

import { mayResolveChargebackPaymentHold } from './event-map-payment-guard';

describe('event map payment hold resolution', () => {
  it('allows only explicit reversal to clear chargeback holds, including unknown provider states', () => {
    expect(mayResolveChargebackPaymentHold('CHARGEBACK_UNKNOWN', 'REVERSED')).toBe(true);
    expect(mayResolveChargebackPaymentHold('IN_DISPUTE', 'REVERSED')).toBe(true);
    expect(mayResolveChargebackPaymentHold('CHARGEBACK_UNKNOWN', 'RECEIVED')).toBe(false);
  });

  it('never lets a chargeback reversal clear a refund hold', () => {
    expect(mayResolveChargebackPaymentHold('REFUND_REQUESTED', 'REVERSED')).toBe(false);
    expect(mayResolveChargebackPaymentHold('REFUNDED', 'REVERSED')).toBe(false);
  });
});
