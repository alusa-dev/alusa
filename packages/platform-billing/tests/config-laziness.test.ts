import { describe, expect, it } from 'vitest';
import { resolveStripePriceId } from '../src';

describe('@alusa/platform-billing config laziness', () => {
  it('não exige Price IDs até uma resolução ser solicitada', async () => {
    const mod = await import('../src');

    expect(mod.PLATFORM_PLANS.BAND_001_025.code).toBe('BAND_001_025');
  });

  it('gera erro de Price somente durante resolução', () => {
    expect(() =>
      resolveStripePriceId({
        planCode: 'BAND_001_025',
        environment: 'TEST',
        source: { STRIPE_ENVIRONMENT: 'TEST' },
      }),
    ).toThrow();
  });
});
