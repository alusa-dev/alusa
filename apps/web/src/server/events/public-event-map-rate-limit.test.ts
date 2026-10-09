import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMocks = vi.hoisted(() => ({
  ipFromRequest: vi.fn(),
  rateLimitSubject: vi.fn(),
  strictRateLimitAsync: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => rateLimitMocks);

import {
  enforcePublicEventMapOrderStatusRateLimit,
  enforcePublicEventMapOrderStatusSubjectRateLimit,
  enforcePublicEventMapPaymentSyncRateLimit,
  enforcePublicEventMapRateLimit,
} from './public-event-map-rate-limit';

describe('public event map rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMocks.ipFromRequest.mockReturnValue('127.0.0.1');
    rateLimitMocks.rateLimitSubject.mockResolvedValue('hashed-client');
    rateLimitMocks.strictRateLimitAsync.mockResolvedValue({ ok: true, remaining: 3, resetAt: 20_000 });
  });

  it.each(['reserve', 'checkout'] as const)('limits %s only by stable subject', async (operation) => {
    const request = new Request(`https://alusa.example/api/public/event-maps/map_123/${operation}`);

    expect(await enforcePublicEventMapRateLimit(request, operation)).toBeNull();
    expect(rateLimitMocks.strictRateLimitAsync).toHaveBeenCalledWith(
      `public:event-map:${operation}:subject:hashed-client`, 1_500, 5 * 60_000,
    );
  });

  it('returns 429 with Retry-After when the subject budget is reached', async () => {
    rateLimitMocks.strictRateLimitAsync.mockResolvedValue({ ok: false, remaining: 0, resetAt: Date.now() + 4_000 });

    const response = await enforcePublicEventMapRateLimit(
      new Request('https://alusa.example/api/public/event-maps/map_123/checkout'), 'checkout',
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('4');
    expect(await response?.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('uses a fixed shared fallback when a trustworthy proxy IP is unavailable', async () => {
    const request = new Request('https://alusa.example/api/public/event-maps/map_123/reserve', {
      headers: { 'user-agent': 'attacker-controlled-a', 'accept-language': 'pt-BR' },
    });
    rateLimitMocks.ipFromRequest.mockReturnValue('ua:attacker-controlled-a|al:pt-BR');

    expect(await enforcePublicEventMapRateLimit(request, 'reserve')).toBeNull();
    expect(rateLimitMocks.rateLimitSubject).toHaveBeenCalledWith('public-event-map:untrusted-origin');
    expect(rateLimitMocks.strictRateLimitAsync).toHaveBeenCalledWith(
      'public:event-map:reserve:subject:hashed-client', 1_500, 5 * 60_000,
    );

    rateLimitMocks.ipFromRequest.mockReturnValue('ua:attacker-controlled-b|al:en-US');
    rateLimitMocks.rateLimitSubject.mockClear();
    rateLimitMocks.strictRateLimitAsync.mockClear();
    expect(await enforcePublicEventMapRateLimit(request, 'reserve')).toBeNull();
    expect(rateLimitMocks.rateLimitSubject).toHaveBeenCalledWith('public-event-map:untrusted-origin');
    expect(rateLimitMocks.strictRateLimitAsync).toHaveBeenCalledWith(
      'public:event-map:reserve:subject:hashed-client', 1_500, 5 * 60_000,
    );
  });

  it('applies the aggregate status budget before order lookup', async () => {
    const request = new Request('https://alusa.example/api/public/event-map-orders/order_1/status');

    expect(await enforcePublicEventMapOrderStatusSubjectRateLimit(request)).toBeNull();
    expect(rateLimitMocks.strictRateLimitAsync).toHaveBeenCalledWith(
      'public:event-map-order-status-subject:hashed-client', 15_000, 5 * 60_000,
    );
  });

  it('applies the per-order status budget after token validation', async () => {
    const request = new Request('https://alusa.example/api/public/event-map-orders/order_1/status');

    expect(await enforcePublicEventMapOrderStatusRateLimit(request, 'order_1')).toBeNull();
    expect(rateLimitMocks.strictRateLimitAsync).toHaveBeenCalledWith(
      'public:event-map-order-status:order_1:hashed-client', 60, 5 * 60_000,
    );
  });

  it('limits manual payment sync only by stable subject', async () => {
    const request = new Request('https://alusa.example/api/public/event-map-orders/order_1/sync-payment');

    expect(await enforcePublicEventMapPaymentSyncRateLimit(request)).toBeNull();
    expect(rateLimitMocks.strictRateLimitAsync).toHaveBeenCalledWith(
      'public:event-map-payment-sync:subject:hashed-client', 20, 15 * 60_000,
    );
  });
});
