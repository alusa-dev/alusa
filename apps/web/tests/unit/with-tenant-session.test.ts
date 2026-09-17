import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSessionMock = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: vi.fn(),
}));

import { resolveTenantSession } from '@/lib/api/with-tenant-session';

describe('resolveTenantSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falha fechado quando não existe sessão completa', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { contaId: 'conta-a' } });

    await expect(resolveTenantSession()).resolves.toEqual({
      ok: false,
      reason: 'UNAUTHENTICATED',
    });
  });

  it('falha fechado quando o provedor de sessão lança erro', async () => {
    getServerSessionMock.mockImplementationOnce(() => {
      throw new Error('session provider unavailable');
    });

    await expect(resolveTenantSession()).resolves.toEqual({
      ok: false,
      reason: 'UNAUTHENTICATED',
    });
  });

  it('usa a conta da sessão como autoridade e normaliza os identificadores', async () => {
    getServerSessionMock.mockResolvedValueOnce({
      user: {
        id: ' user-a ',
        contaId: ' conta-a ',
        role: ' financeiro ',
      },
    });

    await expect(resolveTenantSession('conta-a')).resolves.toMatchObject({
      ok: true,
      userId: 'user-a',
      contaId: 'conta-a',
      role: 'financeiro',
    });
  });

  it('rejeita conta informada pelo cliente quando diverge da sessão', async () => {
    getServerSessionMock.mockResolvedValueOnce({
      user: { id: 'user-a', contaId: 'conta-a', role: 'ADMIN' },
    });

    await expect(resolveTenantSession('conta-b')).resolves.toEqual({
      ok: false,
      reason: 'CONTA_MISMATCH',
    });
  });
});
