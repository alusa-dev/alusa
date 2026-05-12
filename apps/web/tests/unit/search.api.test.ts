/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  aluno: { findMany: vi.fn() },
  responsavel: { findMany: vi.fn() },
  matricula: { findMany: vi.fn() },
  cobranca: { findMany: vi.fn() },
  contrato: { findMany: vi.fn() },
}));

vi.mock('next-auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

const { GET } = await import('@/app/api/search/route');

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const response = await GET(new NextRequest('http://localhost/api/search?q=maria'));

    expect(response.status).toBe(401);
  });

  it('retorna grupos vazios quando a query é curta', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1', role: 'ADMIN' },
    });

    const response = await GET(new NextRequest('http://localhost/api/search?q=m'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ query: 'm', groups: [] });
    expect(prismaMock.aluno.findMany).not.toHaveBeenCalled();
  });

  it('retorna apenas grupos de entidades para perfis internos', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });

    prismaMock.aluno.findMany.mockResolvedValueOnce([
      { id: 'aluno-1', nome: 'Maria Silva', cpf: '12345678900', email: 'maria@example.com' },
    ]);
    prismaMock.responsavel.findMany.mockResolvedValueOnce([]);
    prismaMock.matricula.findMany.mockResolvedValueOnce([]);
    prismaMock.cobranca.findMany.mockResolvedValueOnce([]);
    prismaMock.contrato.findMany.mockResolvedValueOnce([]);

    const response = await GET(new NextRequest('http://localhost/api/search?q=alunos'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.query).toBe('alunos');
    expect(json.groups).toEqual([
      expect.objectContaining({
        key: 'alunos',
        items: [
          expect.objectContaining({ title: 'Maria Silva', href: '/alunos/aluno-1', type: 'aluno' }),
        ],
      }),
    ]);
    expect(prismaMock.aluno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contaId: 'conta-1' }),
      }),
    );
  });

  it('não retorna atalhos fixos para perfis de portal', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1', role: 'ALUNO' },
    });

    const response = await GET(new NextRequest('http://localhost/api/search?q=portal'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.groups).toEqual([]);
    expect(prismaMock.aluno.findMany).not.toHaveBeenCalled();
  });

  it('retorna cobranca com aluno no titulo e tipo especifico no badge', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });

    prismaMock.aluno.findMany.mockResolvedValueOnce([]);
    prismaMock.responsavel.findMany.mockResolvedValueOnce([]);
    prismaMock.matricula.findMany.mockResolvedValueOnce([]);
    prismaMock.cobranca.findMany.mockResolvedValueOnce([
      {
        id: 'cob-1',
        tipo: 'TAXA_MATRICULA',
        status: 'PENDENTE',
        valor: '150.00',
        asaasPaymentId: 'pay_123',
        matricula: { aluno: { nome: 'Guilherme Araújo Souza' } },
      },
    ]);
    prismaMock.contrato.findMany.mockResolvedValueOnce([]);

    const response = await GET(new NextRequest('http://localhost/api/search?q=taxa'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.groups).toEqual([
      expect.objectContaining({
        key: 'cobrancas',
        items: [
          expect.objectContaining({
            type: 'cobranca',
            title: 'Guilherme Araújo Souza',
            description: 'pay_123',
            badgeLabel: 'Taxa de matrícula',
            href: '/cobrancas/cob-1',
          }),
        ],
      }),
    ]);
  });
});