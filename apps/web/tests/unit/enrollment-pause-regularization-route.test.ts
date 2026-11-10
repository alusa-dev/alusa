import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runTenant: vi.fn(),
  assertPlatformAccess: vi.fn(),
}));
vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: mocks.auth }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: mocks.runTenant }));
vi.mock('@/src/server/platform-billing/capacity', () => ({
  assertPlatformAccessForConta: mocks.assertPlatformAccess,
  platformBillingAccessResponse: vi.fn(() => null),
}));

import { POST } from '@/app/api/matriculas/[id]/regularizar-pausa/route';

describe('POST /api/matriculas/[id]/regularizar-pausa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ ok: true, contaId: 'tenant-a', userId: 'admin-a', role: 'ADMIN', authContext: 'OWNER' });
    mocks.assertPlatformAccess.mockResolvedValue(undefined);
  });

  it('requires institution admin permission', async () => {
    mocks.auth.mockResolvedValueOnce({ ok: true, contaId: 'tenant-a', userId: 'portal-a', role: 'RESPONSAVEL', authContext: 'PORTAL' });
    const response = await POST(new Request('https://alusa.test/regularizar', {
      method: 'POST', body: JSON.stringify({ motivo: 'Retorno confirmado pela instituição.' }),
    }) as never, { params: Promise.resolve({ id: 'mat-a' }) });
    expect(response.status).toBe(403);
    expect(mocks.runTenant).not.toHaveBeenCalled();
  });

  it('persists the regularization in the session tenant with administrator and reason', async () => {
    const operationCreate = vi.fn().mockResolvedValue({ id: 'operation-a', tipo: 'REGULARIZACAO_PAUSA' });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      conta: { findFirst: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      matricula: { findFirst: vi.fn().mockResolvedValue({
        id: 'mat-a', status: 'PAUSADA', pausaAtiva: true,
        dataRetornoPrevista: new Date('2026-11-01T00:00:00.000Z'),
        dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
      }) },
      matriculaOperacao: {
        findFirst: vi.fn().mockResolvedValue({ id: 'pause-op-a' }),
        findMany: vi.fn().mockResolvedValue([]),
        create: operationCreate,
      },
    };
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback(transaction));

    const response = await POST(new Request('https://alusa.test/regularizar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Retorno confirmado pela instituição.' }),
    }) as never, { params: Promise.resolve({ id: 'mat-a' }) });

    expect(response.status).toBe(200);
    expect(mocks.runTenant).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(operationCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      contaId: 'tenant-a', matriculaId: 'mat-a', tipo: 'REGULARIZACAO_PAUSA',
      actorId: 'admin-a', observacao: 'Retorno confirmado pela instituição.',
    }) }));
  });
});
