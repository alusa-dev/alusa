import { describe, expect, it } from 'vitest';

import { normalizeEventMapChargebackStatus, resolveEventMapChargebackStatus } from '../event-map-chargeback-status';

describe('event map chargeback status', () => {
  it('preserves the exact Asaas enum values', () => {
    expect(resolveEventMapChargebackStatus(null, 'DISPUTE_LOST')).toBe('DISPUTE_LOST');
    expect(resolveEventMapChargebackStatus('IN_DISPUTE', 'REVERSED')).toBe('REVERSED');
  });

  it('does not regress terminal outcomes when old events arrive later', () => {
    expect(resolveEventMapChargebackStatus('REVERSED', 'REQUESTED')).toBe('REVERSED');
    expect(resolveEventMapChargebackStatus('DISPUTE_LOST', 'IN_DISPUTE')).toBe('DISPUTE_LOST');
    expect(resolveEventMapChargebackStatus('IN_DISPUTE', 'REQUESTED')).toBe('IN_DISPUTE');
  });

  it('allows a provider reversal to supersede a lost dispute', () => {
    expect(resolveEventMapChargebackStatus('DISPUTE_LOST', 'REVERSED')).toBe('REVERSED');
  });

  it('fails closed for unknown provider values while retaining the raw value for audit', () => {
    expect(normalizeEventMapChargebackStatus('FUTURE_PROVIDER_STATE')).toEqual({
      paymentStatus: 'CHARGEBACK_UNKNOWN', rawStatus: 'FUTURE_PROVIDER_STATE', known: false,
    });
    expect(resolveEventMapChargebackStatus(null, 'CHARGEBACK_UNKNOWN')).toBe('CHARGEBACK_UNKNOWN');
    expect(resolveEventMapChargebackStatus('CHARGEBACK_UNKNOWN', 'REQUESTED')).toBe('CHARGEBACK_UNKNOWN');
    expect(normalizeEventMapChargebackStatus('DISPUTE_LOST').known).toBe(true);
  });
});
