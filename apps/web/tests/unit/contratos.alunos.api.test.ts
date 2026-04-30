/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/prisma/client', () => ({
  prisma: {
    aluno: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getSessionUser: vi.fn(),
}));

const { prisma } = await import('@/prisma/client');
const { getSessionUser } = await import('@/lib/auth/session');
const { GET } = await import('../../app/api/contratos/alunos/route');

describe('GET /api/contratos/alunos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/contratos/alunos');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('retorna 400 para status inválido', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ contaId: 'conta-1' } as never);

    const req = new NextRequest('http://localhost/api/contratos/alunos?status=INVALIDO');
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it('lista alunos com contratos filtrando por conta', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ contaId: 'conta-1' } as never);

    vi.mocked(prisma.aluno.findMany).mockResolvedValue([
      { id: 'a1', nome: 'Aluno 1', foto: null },
      { id: 'a2', nome: 'Aluno 2', foto: 'https://example.com/f.png' },
    ] as never);

    const req = new NextRequest('http://localhost/api/contratos/alunos?q=aluno&status=PENDENTE&turmaId=t1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(prisma.aluno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          matriculas: expect.any(Object),
        }),
        select: { id: true, nome: true, foto: true },
      }),
    );

    const json = await res.json();
    expect(json).toEqual([
      { id: 'a1', nome: 'Aluno 1', foto: null },
      { id: 'a2', nome: 'Aluno 2', foto: 'https://example.com/f.png' },
    ]);
  });
});
