import { describe, expect, it } from 'vitest';

import { decideBillingAdjustmentFailure } from './adjustment-processor';

const NOW = new Date('2026-07-31T12:00:00.000Z');

describe('decideBillingAdjustmentFailure', () => {
  it('repete complemento com backoff antes de exigir reconciliação', () => {
    const retry = decideBillingAdjustmentFailure({
      type: 'COMPLEMENT', attemptsBeforeClaim: 0, message: 'ASAAS_UNAVAILABLE', now: NOW,
    });
    expect(retry.status).toBe('FAILED');
    expect(retry.reconcile).toBe(false);
    expect(retry.availableAt.getTime()).toBeGreaterThan(NOW.getTime());

    expect(decideBillingAdjustmentFailure({
      type: 'COMPLEMENT', attemptsBeforeClaim: 4, message: 'ASAAS_UNAVAILABLE', now: NOW,
    })).toEqual({ status: 'REQUIRES_RECONCILIATION', availableAt: NOW, reconcile: true });
  });

  it('mantém crédito pendente enquanto aguarda a próxima cobrança', () => {
    expect(decideBillingAdjustmentFailure({
      type: 'CREDIT', attemptsBeforeClaim: 8, message: 'CREDITO_AGUARDANDO_PROXIMA_COBRANCA', now: NOW,
    })).toEqual({
      status: 'PENDING',
      availableAt: new Date('2026-08-01T12:00:00.000Z'),
      reconcile: false,
    });
  });
});
