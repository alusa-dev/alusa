import { describe, expect, it } from 'vitest';
import {
  PlatformBillingError,
  classifyPlatformBillingWebhookError,
  computePlatformBillingWebhookNextAttemptAt,
  hasExhaustedPlatformBillingWebhookAttempts,
} from '../src';

describe('@alusa/platform-billing webhook retry policy', () => {
  it('usa backoff exponencial com jitter controlado', () => {
    const next = computePlatformBillingWebhookNextAttemptAt({
      attempts: 3,
      now: new Date('2026-06-01T00:00:00.000Z'),
      random: () => 0,
    });

    expect(next.toISOString()).toBe('2026-06-01T00:02:00.000Z');
  });

  it('classifica price desconhecido como erro permanente', () => {
    const error = new PlatformBillingError('unknown', 'PLATFORM_PRICE_UNKNOWN');
    expect(classifyPlatformBillingWebhookError(error)).toBe('PERMANENT');
  });

  it('esgota após limite de tentativas', () => {
    expect(hasExhaustedPlatformBillingWebhookAttempts({ attempts: 10 })).toBe(true);
    expect(hasExhaustedPlatformBillingWebhookAttempts({ attempts: 9 })).toBe(false);
  });
});
