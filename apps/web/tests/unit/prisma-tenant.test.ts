import { describe, expect, it, vi } from 'vitest';

const tenantMocks = vi.hoisted(() => ({
  runWithTenant: vi.fn(async (_contaId: string, callback: () => Promise<unknown>) => callback()),
  isRlsRuntimeEnabled: vi.fn(() => true),
  normalizeTenantId: vi.fn((contaId: string) => contaId.trim()),
  getTenantPrismaClient: vi.fn(),
}));

vi.mock('@alusa/database', () => tenantMocks);

import { isRlsRuntimeEnabled, runWithTenant } from '@/lib/prisma-tenant';

describe('web tenant database adapter', () => {
  it('reexports the canonical database tenant runtime', async () => {
    const result = await runWithTenant('conta-1', async () => 'tenant result');

    expect(result).toBe('tenant result');
    expect(tenantMocks.runWithTenant).toHaveBeenCalledWith('conta-1', expect.any(Function));
    expect(isRlsRuntimeEnabled()).toBe(true);
    expect(tenantMocks.isRlsRuntimeEnabled).toHaveBeenCalledOnce();
  });
});
