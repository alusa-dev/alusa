import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runWithTenant: vi.fn() }));

vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: mocks.runWithTenant }));

describe('platform billing route access guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed with a safe 503 when billing access lookup fails', async () => {
    mocks.runWithTenant.mockImplementation(() => Promise.reject(new Error('database connection details')));
    const { platformBillingAccessResponseForConta } = await vi.importActual<typeof import('./capacity')>('./capacity');

    const response = await platformBillingAccessResponseForConta({
      contaId: 'conta-a',
      capability: 'FINANCIAL_CONFIG_WRITE',
    });

    expect(mocks.runWithTenant).toHaveBeenCalledWith('conta-a', expect.any(Function));
    expect(response).toEqual({
      status: 503,
      body: {
        error: 'PLATFORM_BILLING_ACCESS_UNAVAILABLE',
        message: 'Não foi possível verificar o acesso da conta. Tente novamente em instantes.',
      },
    });
  });
});
