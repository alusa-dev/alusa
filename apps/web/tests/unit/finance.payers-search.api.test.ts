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
const mockCustomerFindUnique = vi.hoisted(() => vi.fn());
const mockCustomerPayerFindUnique = vi.hoisted(() => vi.fn());
const mockFindCustomerForPayer = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    aluno: { findMany: mockAlunoFindMany },
    responsavel: { findMany: mockResponsavelFindMany },
    customer: { findUnique: mockCustomerFindUnique },
    customerPayer: { findUnique: mockCustomerPayerFindUnique },
  },
}));

vi.mock('@alusa/finance', () => ({ findCustomerForPayer: mockFindCustomerForPayer }));

import { GET } from '@/app/api/finance/payers/search/route';

describe('GET /api/finance/payers/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindCustomerForPayer.mockResolvedValue(null);
  });

  it('retorna 401 quando não autenticado', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=br'));

    expect(response.status).toBe(401);
  });

  it('busca aluno menor pelo responsável e retorna apenas o responsável financeiro', async () => {
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
              cpf: '04410435264',
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
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({
      id: 'resp-1',
      name: 'Bryan de Alencar Bezerra',
      type: 'responsavel',
      isMinor: false,
      payerResolved: {
        type: 'responsavel',
        id: 'resp-1',
        name: 'Bryan de Alencar Bezerra',
        hasAsaasCustomerId: true,
      },
    });
  });

  it('busca pelo nome do aluno menor e retorna o responsável financeiro, não o aluno', async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' } });
    mockAlunoFindMany.mockResolvedValueOnce([
      {
        id: 'aluno-2',
        nome: 'Nicole de Alencar Bezerra',
        cpf: '12345678901',
        dataNasc: new Date('2015-01-01T00:00:00.000Z'),
        asaasCustomerId: null,
        responsaveis: [
          {
            responsavel: {
              id: 'resp-1',
              nome: 'Bryan de Alencar Bezerra',
              cpf: '04410435264',
              asaasCustomerId: 'cus_resp_1',
            },
          },
        ],
      },
    ]);
    mockResponsavelFindMany.mockResolvedValueOnce([]);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=nicole'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({
      id: 'resp-1',
      type: 'responsavel',
      name: 'Bryan de Alencar Bezerra',
    });
    expect(json.results.some((item: { id: string }) => item.id === 'aluno-2')).toBe(false);
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

  it('busca pelo nome do responsável e retorna apenas o responsável, não os filhos vinculados', async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' } });
    mockAlunoFindMany.mockResolvedValueOnce([
      {
        id: 'aluno-adulto',
        nome: 'Bryan de Alencar Bezerra',
        cpf: '04410435264',
        dataNasc: new Date('1960-01-01T00:00:00.000Z'),
        asaasCustomerId: 'cus_bryan',
        responsaveis: [
          {
            responsavel: {
              id: 'resp-vera',
              nome: 'Vera Lúcia Gomes de Alencar',
              cpf: '11122233344',
              asaasCustomerId: 'cus_vera',
            },
          },
        ],
      },
      {
        id: 'aluno-menor',
        nome: 'Keison de Alencar Bezerra',
        cpf: '99988877766',
        dataNasc: new Date('2015-01-01T00:00:00.000Z'),
        asaasCustomerId: null,
        responsaveis: [
          {
            responsavel: {
              id: 'resp-vera',
              nome: 'Vera Lúcia Gomes de Alencar',
              cpf: '11122233344',
              asaasCustomerId: 'cus_vera',
            },
          },
        ],
      },
    ]);
    mockResponsavelFindMany.mockResolvedValueOnce([
      {
        id: 'resp-vera',
        nome: 'Vera Lúcia Gomes de Alencar',
        cpf: '11122233344',
        asaasCustomerId: 'cus_vera',
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=vera'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({
      id: 'resp-vera',
      name: 'Vera Lúcia Gomes de Alencar',
      type: 'responsavel',
    });
    expect(json.results.some((item: { id: string }) => item.id.startsWith('aluno-'))).toBe(false);
  });

  it('agrupa os alunos irmãos quando a busca da venda é feita diretamente pelo responsável', async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' } });
    const respBryan = {
      id: 'resp-bryan',
      nome: 'Bryan de Alencar Bezerra',
      cpf: '04410435264',
      asaasCustomerId: 'cus-bryan',
    };
    mockAlunoFindMany.mockResolvedValueOnce([
      {
        id: 'aluno-nicole', nome: 'Maria Eduarda Nevez', cpf: null,
        dataNasc: new Date('2014-05-10T00:00:00.000Z'), asaasCustomerId: null,
        responsaveis: [{ responsavel: respBryan }],
      },
      {
        id: 'aluno-pedro', nome: 'Nicole da Silva Bezerra', cpf: null,
        dataNasc: new Date('2015-05-10T00:00:00.000Z'), asaasCustomerId: null,
        responsaveis: [{ responsavel: respBryan }],
      },
    ]);
    mockResponsavelFindMany.mockResolvedValueOnce([respBryan]);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=bryan&context=sales'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({
      id: 'resp-bryan',
      type: 'responsavel',
      name: 'Bryan de Alencar Bezerra',
      salesDisplayName: 'Maria Nevez e Nicole Bezerra',
      payerResolved: { type: 'responsavel', id: 'resp-bryan' },
    });
  });

  it('mantém o nome completo quando há apenas um aluno vinculado ao responsável', async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' } });
    const responsible = {
      id: 'resp-single', nome: 'Bryan de Alencar Bezerra', cpf: null, asaasCustomerId: 'cus-bryan',
    };
    mockAlunoFindMany.mockResolvedValueOnce([
      {
        id: 'aluno-single', nome: 'Maria Eduarda Nevez', cpf: null,
        dataNasc: new Date('2014-05-10T00:00:00.000Z'), asaasCustomerId: null,
        responsaveis: [{ responsavel: responsible }],
      },
    ]);
    mockResponsavelFindMany.mockResolvedValueOnce([responsible]);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=bryan&context=sales'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0].salesDisplayName).toBe('Maria Eduarda Nevez');
  });

  it('mantém o aluno quando a busca da venda é feita pelo nome do aluno menor', async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' } });
    mockAlunoFindMany.mockResolvedValueOnce([
      {
        id: 'aluno-nicole', nome: 'Nicole Bezerra', cpf: null,
        dataNasc: new Date('2014-05-10T00:00:00.000Z'), asaasCustomerId: null,
        responsaveis: [{ responsavel: {
          id: 'resp-bryan', nome: 'Bryan de Alencar Bezerra', cpf: null, asaasCustomerId: 'cus-bryan',
        } }],
      },
    ]);
    mockResponsavelFindMany.mockResolvedValueOnce([]);

    const response = await GET(new NextRequest('http://localhost/api/finance/payers/search?q=nicole&context=sales'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({
      id: 'aluno-nicole',
      type: 'aluno',
      name: 'Nicole Bezerra',
      payerResolved: { type: 'responsavel', id: 'resp-bryan' },
    });
  });
});
