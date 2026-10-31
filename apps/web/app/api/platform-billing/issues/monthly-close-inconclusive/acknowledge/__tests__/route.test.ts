import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { state, updateManyMock, actorMock } = vi.hoisted(() => ({
  state: { authenticated: true },
  updateManyMock: vi.fn(async () => ({ count: 1 })),
  actorMock: vi.fn(async () => ({ canManagePlatformBilling: true })),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({
  withTenantSession: async (handler: (_context: unknown) => Promise<Response>) => {
    if (!state.authenticated) return new NextResponse(null, { status: 401 });
    return handler({ contaId: 'conta-a', userId: 'user-a', tx: { platformBillingIssue: { updateMany: updateManyMock } } });
  },
}));
vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  resolvePlatformBillingActor: actorMock,
  resolvePlatformBillingEnvironment: () => 'TEST',
}));

import { POST } from '../route';

function makeRequest(body: unknown) {
  return new NextRequest('http://alusa.test/api/platform-billing/issues/monthly-close-inconclusive/acknowledge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST monthly close issue acknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.authenticated = true;
    actorMock.mockResolvedValue({ canManagePlatformBilling: true });
    updateManyMock.mockResolvedValue({ count: 1 });
  });

  it('updates only the open occurrence belonging to the authenticated tenant and environment', async () => {
    const response = await POST(makeRequest({ issueId: 'issue-a' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ acknowledged: true });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'issue-a',
        contaId: 'conta-a',
        environment: 'TEST',
        code: 'MONTHLY_CLOSE_INCONCLUSIVE',
        status: 'OPEN',
        ignoredAt: null,
      },
      data: { ignoredAt: expect.any(Date) },
    });
  });

  it('returns false when the occurrence has already been acknowledged', async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    const response = await POST(makeRequest({ issueId: 'issue-a' }));
    expect(await response.json()).toEqual({ acknowledged: false });
  });

  it('validates input and billing permission before updating', async () => {
    expect((await POST(makeRequest({ issueId: '' }))).status).toBe(400);
    actorMock.mockResolvedValueOnce({ canManagePlatformBilling: false });
    expect((await POST(makeRequest({ issueId: 'issue-a' }))).status).toBe(403);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('requires an authenticated tenant session', async () => {
    state.authenticated = false;
    expect((await POST(makeRequest({ issueId: 'issue-a' }))).status).toBe(401);
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
