import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  getStatus: vi.fn(),
  subjectRateLimit: vi.fn(async (): Promise<NextResponse | null> => null),
  orderRateLimit: vi.fn(async (): Promise<NextResponse | null> => null),
  routeError: vi.fn((_error: unknown, code: string) => NextResponse.json(
    { error: { code } },
    { status: 500 },
  )),
}));

vi.mock('@alusa/lib/events/map/event-map.service', () => ({
  assertPublicEventMapOrderCapability: mocks.assertCapability,
  getPublicEventMapOrderStatus: mocks.getStatus,
}));
vi.mock('@/src/server/events/public-event-map-rate-limit', () => ({
  enforcePublicEventMapOrderStatusSubjectRateLimit: mocks.subjectRateLimit,
  enforcePublicEventMapOrderStatusRateLimit: mocks.orderRateLimit,
}));
vi.mock('../../../../../events/_helpers', () => ({ handleEventsRouteError: mocks.routeError }));

import { GET } from '../route';

const noStore = 'private, no-store, max-age=0';
const context = { params: Promise.resolve({ orderId: 'order-1' }) };

function request(url = 'https://alusa.test/api/public/event-map-orders/order-1/status?token=buyer-token') {
  return new NextRequest(url);
}

describe('public event order status no-store headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCapability.mockReset();
    mocks.assertCapability.mockResolvedValue(undefined);
    mocks.getStatus.mockReset();
    mocks.routeError.mockReset();
    mocks.routeError.mockImplementation((_error, code) => NextResponse.json(
      { error: { code } },
      { status: 500 },
    ));
    mocks.subjectRateLimit.mockReset();
    mocks.subjectRateLimit.mockResolvedValue(null);
    mocks.orderRateLimit.mockReset();
    mocks.orderRateLimit.mockResolvedValue(null);
  });

  it('does not cache successful status responses', async () => {
    mocks.getStatus.mockResolvedValue({ orderId: 'order-1', status: 'PAYMENT_PENDING' });
    const callOrder: string[] = [];
    mocks.assertCapability.mockImplementation(async () => { callOrder.push('capability'); });
    mocks.orderRateLimit.mockImplementation(async () => {
      callOrder.push('order-rate-limit');
      expect(mocks.getStatus).not.toHaveBeenCalled();
      return null;
    });
    mocks.getStatus.mockImplementation(async () => {
      callOrder.push('status');
      return { orderId: 'order-1', status: 'PAYMENT_PENDING' };
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(noStore);
    expect(mocks.assertCapability).toHaveBeenCalledWith('order-1', 'buyer-token');
    expect(callOrder).toEqual(['capability', 'order-rate-limit', 'status']);
  });

  it('does not cache missing-token or rate-limited responses', async () => {
    const missingToken = await GET(request('https://alusa.test/api/public/event-map-orders/order-1/status'), context);
    expect(mocks.subjectRateLimit).not.toHaveBeenCalled();
    mocks.subjectRateLimit.mockResolvedValue(NextResponse.json(
      { error: { code: 'RATE_LIMITED' } },
      { status: 429, headers: { 'Retry-After': '4' } },
    ));
    const rateLimited = await GET(request(), context);

    expect(missingToken.status).toBe(401);
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get('retry-after')).toBe('4');
    expect(missingToken.headers.get('cache-control')).toBe(noStore);
    expect(rateLimited.headers.get('cache-control')).toBe(noStore);
    expect(mocks.subjectRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.assertCapability).not.toHaveBeenCalled();
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.orderRateLimit).not.toHaveBeenCalled();
  });

  it('rejects an invalid token before the per-order limit and detailed status query', async () => {
    mocks.assertCapability.mockRejectedValue(new Error('invalid capability'));
    mocks.routeError.mockReturnValue(NextResponse.json(
      { error: { code: 'PEDIDO_NAO_ENCONTRADO' } },
      { status: 404 },
    ));

    const response = await GET(request(), context);

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe(noStore);
    expect(await response.json()).toMatchObject({ error: { code: 'PEDIDO_NAO_ENCONTRADO' } });
    expect(mocks.assertCapability).toHaveBeenCalledWith('order-1', 'buyer-token');
    expect(mocks.orderRateLimit).not.toHaveBeenCalled();
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it('returns per-order 429 without loading detailed status', async () => {
    mocks.orderRateLimit.mockResolvedValue(NextResponse.json(
      { error: { code: 'RATE_LIMITED' } },
      { status: 429, headers: { 'Retry-After': '4' } },
    ));

    const response = await GET(request(), context);

    expect(response.status).toBe(429);
    expect(response.headers.get('cache-control')).toBe(noStore);
    expect(mocks.assertCapability).toHaveBeenCalledWith('order-1', 'buyer-token');
    expect(mocks.orderRateLimit).toHaveBeenCalledWith(expect.any(NextRequest), 'order-1');
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it('does not cache service errors', async () => {
    mocks.getStatus.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(request(), context);

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe(noStore);
    expect(mocks.routeError).toHaveBeenCalledWith(expect.any(Error), 'ERRO_OBTER_STATUS_PEDIDO_PUBLICO');
    expect(mocks.assertCapability).toHaveBeenCalledWith('order-1', 'buyer-token');
    expect(mocks.orderRateLimit).toHaveBeenCalledWith(expect.any(NextRequest), 'order-1');
  });
});
