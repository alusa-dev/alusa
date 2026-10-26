import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDiscount: vi.fn(),
  listActiveDiscounts: vi.fn(),
  platformBillingAccessResponseForConta: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({
  resolveTenantSession: vi.fn(async () => ({ ok: true, contaId: 'conta-a', userId: 'user-a', role: 'ADMIN' })),
}));
vi.mock('@/src/server/finance/discount.service', () => ({
  createDiscount: mocks.createDiscount,
  listActiveDiscounts: mocks.listActiveDiscounts,
}));
vi.mock('@/src/server/platform-billing/capacity', () => ({
  platformBillingAccessResponseForConta: mocks.platformBillingAccessResponseForConta,
}));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: () => 'request-a', logApiOperationalEvent: vi.fn() }));

import { POST } from '../route';

const blockedResponse = {
  status: 402,
  body: {
    error: 'PLATFORM_BILLING_ACCESS_RESTRICTED',
    message: 'A conta está restrita.',
    details: { contaId: 'conta-a', capability: 'FINANCIAL_CONFIG_WRITE' },
  },
} as const;

describe('POST /api/descontos platform billing access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformBillingAccessResponseForConta.mockResolvedValue(blockedResponse);
  });

  it('blocks tenant financial configuration mutations when platform billing access is restricted', async () => {
    const response = await POST(new Request('http://alusa.test/api/descontos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Desconto', tipo: 'FIXO', valor: 10 }),
    }));

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual(blockedResponse.body);
    expect(mocks.platformBillingAccessResponseForConta).toHaveBeenCalledWith({
      contaId: 'conta-a',
      capability: 'FINANCIAL_CONFIG_WRITE',
    });
    expect(mocks.createDiscount).not.toHaveBeenCalled();
  });

  it('does not continue a mutation when billing access verification is unavailable', async () => {
    mocks.platformBillingAccessResponseForConta.mockResolvedValue({
      status: 503,
      body: { error: 'PLATFORM_BILLING_ACCESS_UNAVAILABLE' },
    });

    const response = await POST(new Request('http://alusa.test/api/descontos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Desconto', tipo: 'FIXO', valor: 10 }),
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'PLATFORM_BILLING_ACCESS_UNAVAILABLE' });
    expect(mocks.createDiscount).not.toHaveBeenCalled();
  });
});
