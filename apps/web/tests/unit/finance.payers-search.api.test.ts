/**
 * Testes unitários para /api/finance/payers/search
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockAlunoFindMany = vi.hoisted(() => vi.fn());
const mockResponsavelFindMany = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    aluno: { findMany: mockAlunoFindMany },
    responsavel: { findMany: mockResponsavelFindMany },
  },
}));

import { GET } from '@/app/api/finance/payers/search/route';

describe('GET /api/finance/payers/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=br'));

    expect(response.status).toBe(401);
  });

  it('busca aluno pelo nome do responsável e não duplica responsável vinculado ao menor', async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' } });
    mockAlunoFindMany.mockResolvedValueOnce([
      {
        id: 'aluno-1',
        nome: 'Kelison de Alencar Bezerra',
        cpf: '02719786276',
        dataNasc: new Date('2014-05-10T00:00:00.000Z'),
        asaasCustomerId: null,
        responsaveis: [
          {
            responsavel: {
              id: 'resp-1',
              nome: 'Bryan de Alencar Bezerra',
              asaasCustomerId: 'cus_resp_1',
            },
          },
        ],
      },
    ]);
    mockResponsavelFindMany.mockResolvedValueOnce([
      {
        id: 'resp-1',
        nome: 'Bryan de Alencar Bezerra',
        cpf: '04410435264',
        asaasCustomerId: 'cus_resp_1',
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=bryan'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockAlunoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          OR: expect.arrayContaining([
            expect.objectContaining({ nome: { contains: 'bryan', mode: 'insensitive' } }),
            expect.objectContaining({
              responsaveis: {
                some: expect.objectContaining({
                  OR: expect.arrayContaining([
                    expect.objectContaining({
                      responsavel: expect.objectContaining({
                        financeiro: true,
                        nome: { contains: 'bryan', mode: 'insensitive' },
                      }),
                    }),
                  ]),
                }),
              },
            }),
          ]),
        }),
      }),
    );
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({
      id: 'aluno-1',
      name: 'Kelison de Alencar Bezerra',
      type: 'aluno',
      isMinor: true,
      responsibleId: 'resp-1',
      responsibleName: 'Bryan de Alencar Bezerra',
      payerResolved: {
        type: 'responsavel',
        id: 'resp-1',
        name: 'Bryan de Alencar Bezerra',
      },
    });
  });

  it('mantém responsável avulso quando ele não resolve aluno menor no resultado', async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' } });
    mockAlunoFindMany.mockResolvedValueOnce([]);
    mockResponsavelFindMany.mockResolvedValueOnce([
      {
        id: 'resp-2',
        nome: 'Vera Lúcia Gomes de Alencar',
        cpf: '11122233344',
        asaasCustomerId: null,
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=vera'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({
      id: 'resp-2',
      name: 'Vera Lúcia Gomes de Alencar',
      type: 'responsavel',
      payerResolved: {
        type: 'responsavel',
        id: 'resp-2',
        name: 'Vera Lúcia Gomes de Alencar',
      },
    });
  });
});