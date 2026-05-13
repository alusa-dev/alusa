import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const { prismaMock, resolveTenantScopeMock } = vi.hoisted(() => ({
  prismaMock: {
    conta: {
      update: vi.fn(),
    },
  },
  resolveTenantScopeMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

vi.mock('@/lib/auth/tenant-scope', () => ({
  resolveTenantScope: resolveTenantScopeMock,
}));

import { PATCH } from '@/app/api/users/me/school/route';

describe('PATCH /api/users/me/school', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita usuário sem permissão de admin', async () => {
    resolveTenantScopeMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: { code: 'PERMISSAO_NEGADA' } }, { status: 403 }),
    });

    const response = await PATCH(
      new Request('http://localhost/api/users/me/school', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Nova Escola' }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it('atualiza a conta quando o admin está autenticado', async () => {
    resolveTenantScopeMock.mockResolvedValueOnce({
      ok: true,
      contaId: 'conta-1',
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
      isAdmin: true,
      isCron: false,
    });
    prismaMock.conta.update.mockResolvedValueOnce({
      id: 'conta-1',
      nome: 'Escola Segura',
      cpfCnpj: '12345678000199',
      status: 'ATIVO',
      ownerUserId: 'owner-1',
      timezone: 'America/Sao_Paulo',
    });

    const response = await PATCH(
      new Request('http://localhost/api/users/me/school', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Escola Segura', cpfCnpj: '12.345.678/0001-99' }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(prismaMock.conta.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conta-1' },
      }),
    );
    expect(json).toMatchObject({
      id: 'conta-1',
      name: 'Escola Segura',
      cpfCnpj: '12345678000199',
      timezone: 'America/Sao_Paulo',
    });
  });
});
