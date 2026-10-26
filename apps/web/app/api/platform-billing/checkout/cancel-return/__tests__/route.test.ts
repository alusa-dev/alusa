import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { state, cancelMock, actorMock } = vi.hoisted(() => ({
  state: { authenticated: true, canManage: true },
  cancelMock: vi.fn(async () => 'CANCELED'),
  actorMock: vi.fn(async () => ({ canManagePlatformBilling: true })),
}));

vi.mock('@alusa/platform-billing', () => ({
  cancelPlatformBillingCheckoutReturn: cancelMock,
  createDefaultPlatformBillingStripeGateway: vi.fn(() => ({})),
  createPrismaPlatformBillingStore: vi.fn(() => ({})),
}));
vi.mock('@/lib/api/with-tenant-session', () => ({
  withTenantSession: async (handler: (_context: unknown) => Promise<Response>) => {
    if (!state.authenticated) return new NextResponse(null, { status: 401 });
    return handler({ contaId: 'conta_a', userId: 'user_a', tx: {} });
  },
}));
vi.mock('@/lib/rate-limit', () => ({ ipFromRequest: () => '127.0.0.1', rateLimitAsync: async () => ({ ok: true }) }));
vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  assertCanManagePlatformBilling: () => state.canManage ? null : new NextResponse(null, { status: 403 }),
  resolvePlatformBillingActor: actorMock,
  resolvePlatformBillingEnvironment: () => 'TEST',
}));

import { POST } from '../route';

describe('POST /api/platform-billing/checkout/cancel-return authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.authenticated = true;
    state.canManage = true;
  });

  it('rejects unauthenticated requests without invoking the cancel use case', async () => {
    state.authenticated = false;
    const response = await POST(new NextRequest('http://alusa.test/api/platform-billing/checkout/cancel-return', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('rejects users without billing management permission without invoking the cancel use case', async () => {
    state.canManage = false;
    const response = await POST(new NextRequest('http://alusa.test/api/platform-billing/checkout/cancel-return', { method: 'POST' }));
    expect(response.status).toBe(403);
    expect(actorMock).toHaveBeenCalledWith({ tx: {}, contaId: 'conta_a', userId: 'user_a' });
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('rejects a missing request identity without invoking cancellation', async () => {
    const response = await POST(new NextRequest('http://alusa.test/api/platform-billing/checkout/cancel-return', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(400);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('forwards the validated request identity to the tenant-scoped cancel use case', async () => {
    const response = await POST(new NextRequest('http://alusa.test/api/platform-billing/checkout/cancel-return', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'platform-billing:checkout:1:request-a' }),
    }));
    expect(response.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta_a', idempotencyKey: 'platform-billing:checkout:1:request-a',
    }), expect.any(Object));
  });
});
