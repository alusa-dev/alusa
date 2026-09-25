import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMocks = vi.hoisted(() => ({
  ipFromRequest: vi.fn(),
  rateLimitSubject: vi.fn(),
  strictRateLimitAsync: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => rateLimitMocks);

import { enforcePublicEventMapPaymentSyncRateLimit, enforcePublicEventMapRateLimit } from './public-event-map-rate-limit';

describe('public event map rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMocks.ipFromRequest.mockReturnValue('127.0.0.1');
    rateLimitMocks.rateLimitSubject.mockResolvedValue('hashed-client');
    rateLimitMocks.strictRateLimitAsync.mockResolvedValue({ ok: true, remaining: 3, resetAt: 20_000 });
  });

  it('bounds reservation and checkout attempts per map and client', async () => {
    const request = new Request('https://alusa.example/api/public/event-maps/map_123/reserve');

    expect(await enforcePublicEventMapRateLimit(request, 'reserve', 'map_123')).toBeNull();
    expect(rateLimitMocks.strictRateLimitAsync.mock.calls).toEqual([
      ['public:event-map:reserve:map_123:hashed-client', 30, 5 * 60_000],
      ['public:event-map:reserve:subject:hashed-client', 90, 5 * 60_000],
    ]);

    rateLimitMocks.strictRateLimitAsync.mockClear();
    expect(await enforcePublicEventMapRateLimit(request, 'checkout', 'map_123')).toBeNull();
    expect(rateLimitMocks.strictRateLimitAsync.mock.calls).toEqual([
      ['public:event-map:checkout:map_123:hashed-client', 8, 5 * 60_000],
      ['public:event-map:checkout:subject:hashed-client', 20, 5 * 60_000],
    ]);
  });

  it('returns 429 with Retry-After when checkout limit is reached', async () => {
    rateLimitMocks.strictRateLimitAsync
      .mockResolvedValueOnce({ ok: true, remaining: 2, resetAt: 20_000 })
      .mockResolvedValueOnce({ ok: false, remaining: 0, resetAt: Date.now() + 4_000 });

    const response = await enforcePublicEventMapRateLimit(
      new Request('https://alusa.example/api/public/event-maps/map_123/checkout'),
      'checkout',
      'map_123',
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('4');
    expect(await response?.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('limits manual Asaas payment checks per order and client', async () => {
    const request = new Request('https://alusa.example/api/public/event-map-orders/order_1/sync-payment');

    expect(await enforcePublicEventMapPaymentSyncRateLimit(request, 'order_1')).toBeNull();
    expect(rateLimitMocks.strictRateLimitAsync.mock.calls).toEqual([
      ['public:event-map-payment-sync:order_1:hashed-client', 3, 15 * 60_000],
      ['public:event-map-payment-sync:subject:hashed-client', 20, 15 * 60_000],
    ]);
  });
});
