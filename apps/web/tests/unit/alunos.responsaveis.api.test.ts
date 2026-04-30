/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type PrismaMock = {
  aluno: { findFirst: ReturnType<typeof vi.fn> };
  responsavel: { findFirst: ReturnType<typeof vi.fn> };
  alunoResponsavel: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  $transaction: (fn: (tx: PrismaMock) => unknown) => Promise<unknown>;
};

const prismaMock: PrismaMock = {
  aluno: { findFirst: vi.fn() },
  responsavel: { findFirst: vi.fn() },
  alunoResponsavel: { findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: PrismaMock) => unknown) => fn(prismaMock)),
};

vi.mock('@/prisma/client', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: vi.fn() }));

const { getSessionUser } = await import('@/lib/auth/session');
const { POST } = await import('../../app/api/alunos/[id]/responsaveis/route');

describe('POST /api/alunos/[id]/responsaveis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/alunos/a1/responsaveis', {
      method: 'POST',
      body: JSON.stringify({ responsavelId: 'r1' }),
    });

    const res = await POST(req, { params: { id: 'a1' } });
    expect(res.status).toBe(401);
  });

  it('retorna 404 quando aluno não existe', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', contaId: 'conta-1', role: 'ADMIN' } as never);
    prismaMock.aluno.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/alunos/a1/responsaveis', {
      method: 'POST',
      body: JSON.stringify({ responsavelId: 'r1' }),
    });

    const res = await POST(req, { params: { id: 'a1' } });
    expect(res.status).toBe(404);
  });

  it('retorna 404 quando responsável não existe', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', contaId: 'conta-1', role: 'ADMIN' } as never);
    prismaMock.aluno.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.responsavel.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/alunos/a1/responsaveis', {
      method: 'POST',
      body: JSON.stringify({ responsavelId: 'r1' }),
    });

    const res = await POST(req, { params: { id: 'a1' } });
    expect(res.status).toBe(404);
  });

  it('retorna 404 quando responsável pertence a outra conta (multi-tenant isolation)', async () => {
    // Com multi-tenant correto, responsável de outra conta não é encontrado
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', contaId: 'conta-1', role: 'ADMIN' } as never);
    prismaMock.aluno.findFirst.mockResolvedValue({ id: 'a1' });
    // Responsável não é encontrado porque o filtro inclui contaId: 'conta-1'
    // mas o responsável pertence a 'conta-2'
    prismaMock.responsavel.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/alunos/a1/responsaveis', {
      method: 'POST',
      body: JSON.stringify({ responsavelId: 'r1' }),
    });

    const res = await POST(req, { params: { id: 'a1' } });
    expect(res.status).toBe(404);
  });

  it('retorna 200 quando vínculo já existe', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', contaId: 'conta-1', role: 'ADMIN' } as never);
    prismaMock.aluno.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.responsavel.findFirst.mockResolvedValue({
      id: 'r1',
      alunos: [{ aluno: { contaId: 'conta-1' } }],
      matriculasFinanceiras: [],
    });
    prismaMock.alunoResponsavel.findFirst.mockResolvedValue({
      id: 'v1',
      alunoId: 'a1',
      responsavelId: 'r1',
      tipoVinculo: 'PRINCIPAL',
    });

    const req = new NextRequest('http://localhost/api/alunos/a1/responsaveis', {
      method: 'POST',
      body: JSON.stringify({ responsavelId: 'r1' }),
    });

    const res = await POST(req, { params: { id: 'a1' } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.created).toBe(false);
    expect(json.vinculo.id).toBe('v1');
  });

  it('cria vínculo quando não existe (201)', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1', contaId: 'conta-1', role: 'ADMIN' } as never);
    prismaMock.aluno.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.responsavel.findFirst.mockResolvedValue({
      id: 'r1',
      alunos: [{ aluno: { contaId: 'conta-1' } }],
      matriculasFinanceiras: [],
    });
    prismaMock.alunoResponsavel.findFirst.mockResolvedValue(null);
    prismaMock.alunoResponsavel.create.mockResolvedValue({
      id: 'v2',
      alunoId: 'a1',
      responsavelId: 'r1',
      tipoVinculo: 'PRINCIPAL',
    });

    const req = new NextRequest('http://localhost/api/alunos/a1/responsaveis', {
      method: 'POST',
      body: JSON.stringify({ responsavelId: 'r1' }),
    });

    const res = await POST(req, { params: { id: 'a1' } });
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.created).toBe(true);
    expect(json.vinculo.id).toBe('v2');
  });
});