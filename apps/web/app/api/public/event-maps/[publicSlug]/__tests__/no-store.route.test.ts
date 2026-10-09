import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { GET } from '../route';
import { POST as reserve } from '../reserve/route';
import { POST as checkout } from '../checkout/route';

const mocks = vi.hoisted(() => ({
  getMap: vi.fn(),
  reserve: vi.fn(),
  checkout: vi.fn(),
  routeError: vi.fn((error: unknown) => Response.json(
    { error: { code: error instanceof ZodError ? 'ERRO_VALIDACAO' : 'FAILED' } },
    { status: error instanceof ZodError ? 422 : 500 },
  )),
  rateLimit: vi.fn(async (): Promise<Response | null> => null),
}));

vi.mock('@alusa/lib/events/map/event-map.service', () => ({
  getPublicEventMap: mocks.getMap,
  reservePublicEventMapSeats: mocks.reserve,
}));
vi.mock('@alusa/finance', () => ({
  completePublicEventMapCheckout: mocks.checkout,
  syncCustomerNotificationChannels: vi.fn(),
}));
vi.mock('../../../../events/_helpers', () => ({ handleEventsRouteError: mocks.routeError }));
vi.mock('@/src/server/events/public-event-map-rate-limit', () => ({
  enforcePublicEventMapRateLimit: mocks.rateLimit,
}));
vi.mock('@/src/server/events/register-event-asaas-payment-provider', () => ({
  ensureEventAsaasPaymentProviderRegistered: vi.fn(),
}));
vi.mock('@/src/server/events/public-order.service', () => ({
  getPublicEventMapOrderCustomerContext: vi.fn(async () => null),
}));
vi.mock('@/lib/observability/api-logger', () => ({
  getRequestId: vi.fn(() => 'request'),
  logApiOperationalEvent: vi.fn(),
}));

const context = { params: Promise.resolve({ publicSlug: 'public-map' }) };
const noStore = 'private, no-store, max-age=0';

function request(url: string, body?: unknown) {
  return new NextRequest(url, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('public event map no-store headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(null);
  });

  it('applies no-store to successful map, reservation, and checkout responses', async () => {
    mocks.getMap.mockResolvedValue({ seats: [] });
    mocks.reserve.mockResolvedValue({ reservationId: 'r1', holdToken: 'secret' });
    mocks.checkout.mockResolvedValue({ orderId: 'o1' });

    const mapResponse = await GET(request('https://alusa.test/api/public/event-maps/public-map'), context);
    const reserveResponse = await reserve(
      request('https://alusa.test/api/public/event-maps/public-map/reserve', { seatIds: ['seat-1'] }),
      context,
    );
    const checkoutResponse = await checkout(
      request('https://alusa.test/api/public/event-maps/public-map/checkout', {
        reservationId: 'reservation-1', holdToken: 'hold-token-1', buyerName: 'Ana Silva',
        buyerEmail: 'ana@example.com', buyerDocument: '52998224725', buyerPhone: '11987654321', paymentMethod: 'PIX',
      }),
      context,
    );

    expect(mapResponse.status).toBe(200);
    expect(reserveResponse.status).toBe(200);
    expect(checkoutResponse.status).toBe(200);
    for (const response of [mapResponse, reserveResponse, checkoutResponse]) {
      expect(response.headers.get('cache-control')).toBe(noStore);
    }
  });

  it('applies no-store to caught errors and validation responses', async () => {
    mocks.getMap.mockRejectedValue(new Error('database unavailable'));
    const mapResponse = await GET(request('https://alusa.test/api/public/event-maps/public-map'), context);
    const reserveResponse = await reserve(
      request('https://alusa.test/api/public/event-maps/public-map/reserve', { seatIds: [] }), context,
    );
    const checkoutResponse = await checkout(
      request('https://alusa.test/api/public/event-maps/public-map/checkout', {}), context,
    );

    expect(mapResponse.status).toBe(500);
    expect(reserveResponse.status).toBe(422);
    expect(checkoutResponse.status).toBe(422);
    for (const response of [mapResponse, reserveResponse, checkoutResponse]) {
      expect(response.headers.get('cache-control')).toBe(noStore);
    }
  });

  it('applies no-store to rate-limited reservation and checkout responses', async () => {
    mocks.rateLimit.mockResolvedValue(NextResponse.json(
      { error: { code: 'RATE_LIMITED' } },
      { status: 429 },
    ));

    const reserveResponse = await reserve(
      request('https://alusa.test/api/public/event-maps/public-map/reserve', { seatIds: ['seat-1'] }), context,
    );
    const checkoutResponse = await checkout(
      request('https://alusa.test/api/public/event-maps/public-map/checkout', {}), context,
    );

    expect(reserveResponse.status).toBe(429);
    expect(checkoutResponse.status).toBe(429);
    for (const response of [reserveResponse, checkoutResponse]) {
      expect(response.headers.get('cache-control')).toBe(noStore);
    }
  });
});
