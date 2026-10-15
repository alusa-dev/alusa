import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  resolveTenantSessionMock,
  refreshPaymentMethodMock,
  rateLimitAsyncMock,
  runWithTenantMock,
  resolveActorMock,
  assertCanManageMock,
} = vi.hoisted(() => ({
  resolveTenantSessionMock: vi.fn(),
  refreshPaymentMethodMock: vi.fn(),
  rateLimitAsyncMock: vi.fn(),
  runWithTenantMock: vi.fn(),
  resolveActorMock: vi.fn(),
  assertCanManageMock: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: resolveTenantSessionMock }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: runWithTenantMock }));
vi.mock('@/src/server/platform-billing/reconciliation', () => ({
  refreshPlatformBillingPaymentMethod: refreshPaymentMethodMock,
}));
vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  resolvePlatformBillingEnvironment: () => 'TEST',
  resolvePlatformBillingActor: resolveActorMock,
  assertCanManagePlatformBilling: assertCanManageMock,
}));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: () => '127.0.0.1',
  rateLimitAsync: rateLimitAsyncMock,
}));

import { GET } from '@/app/api/platform-billing/portal/return/route';

describe('GET /api/platform-billing/portal/return', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantSessionMock.mockResolvedValue({ ok: true, contaId: 'conta-a', userId: 'user-a' });
    refreshPaymentMethodMock.mockResolvedValue(true);
    rateLimitAsyncMock.mockResolvedValue({ ok: true });
    runWithTenantMock.mockImplementation((_contaId, callback) => callback({}));
    resolveActorMock.mockResolvedValue({ canManagePlatformBilling: true });
    assertCanManageMock.mockImplementation((allowed) => allowed ? null : new Response('SEM_PERMISSAO', { status: 403 }));
  });

  it('refreshes the current tenant snapshot and redirects to the validated billing page', async () => {
    const response = await GET(new NextRequest(
      'https://alusa.test/api/platform-billing/portal/return?returnPath=%2Faccount%2Fbilling-plan',
    ));

    expect(refreshPaymentMethodMock).toHaveBeenCalledWith({ contaId: 'conta-a', environment: 'TEST', force: true });
    expect(response.headers.get('location')).toBe('https://alusa.test/account/billing-plan');
  });

  it('still returns the customer to Alusa when the best-effort refresh fails', async () => {
    refreshPaymentMethodMock.mockRejectedValue(new Error('temporary provider error'));

    const response = await GET(new NextRequest(
      'https://alusa.test/api/platform-billing/portal/return?returnPath=%2Faccount%2Fbilling-plan',
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://alusa.test/account/billing-plan');
  });

  it('does not let an unauthenticated request choose an external redirect', async () => {
    resolveTenantSessionMock.mockResolvedValue({ ok: false, reason: 'UNAUTHENTICATED' });

    const response = await GET(new NextRequest(
      'https://alusa.test/api/platform-billing/portal/return?returnPath=https%3A%2F%2Fevil.test',
    ));

    expect(response.headers.get('location')).toBe('https://alusa.test/login');
    expect(refreshPaymentMethodMock).not.toHaveBeenCalled();
  });

  it('keeps the portal return available without another Stripe read when rate limited', async () => {
    rateLimitAsyncMock.mockResolvedValue({ ok: false, resetAt: Date.now() + 60_000 });

    const response = await GET(new NextRequest(
      'https://alusa.test/api/platform-billing/portal/return?returnPath=%2Faccount%2Fbilling-plan',
    ));

    expect(response.headers.get('location')).toBe('https://alusa.test/account/billing-plan');
    expect(refreshPaymentMethodMock).not.toHaveBeenCalled();
  });

  it('requires the same platform-billing management permission as portal creation', async () => {
    resolveActorMock.mockResolvedValue({ canManagePlatformBilling: false });
    assertCanManageMock.mockImplementation(() => new Response('SEM_PERMISSAO', { status: 403 }));

    const response = await GET(new NextRequest(
      'https://alusa.test/api/platform-billing/portal/return?returnPath=%2Faccount%2Fbilling-plan',
    ));

    expect(runWithTenantMock).toHaveBeenCalledWith('conta-a', expect.any(Function));
    expect(resolveActorMock).toHaveBeenCalledWith({ tx: {}, contaId: 'conta-a', userId: 'user-a' });
    expect(assertCanManageMock).toHaveBeenCalledWith(false);
    expect(response.status).toBe(403);
    expect(refreshPaymentMethodMock).not.toHaveBeenCalled();
  });
});
