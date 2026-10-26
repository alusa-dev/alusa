import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runWithTenant: vi.fn() }));

vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: mocks.runWithTenant }));

import { platformBillingAccessResponseForConta } from './capacity';

describe('platform billing route access guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed with a safe 503 when billing access lookup fails', async () => {
    mocks.runWithTenant.mockRejectedValue(new Error('database connection details'));

    await expect(platformBillingAccessResponseForConta({
      contaId: 'conta-a',
      capability: 'FINANCIAL_CONFIG_WRITE',
    })).resolves.toEqual({
      status: 503,
      body: {
        error: 'PLATFORM_BILLING_ACCESS_UNAVAILABLE',
        message: 'Não foi possível verificar o acesso da conta. Tente novamente em instantes.',
      },
    });
    expect(mocks.runWithTenant).toHaveBeenCalledWith('conta-a', expect.any(Function));
  });
});
