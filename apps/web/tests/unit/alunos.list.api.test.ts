/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockTx, mockCtx } = vi.hoisted(() => {
  const tx = {
    aluno: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  };
  return {
    mockTx: tx,
    mockCtx: {
      contaId: 'conta-1',
      userId: 'user-1',
      tx,
    },
  };
});

vi.mock('@/lib/api/with-tenant-session', () => ({
  withTenantSession: vi.fn(async (handler: (ctx: typeof mockCtx) => unknown) => handler(mockCtx)),
}));

import { GET } from '@/app/api/alunos/route';

describe('GET /api/alunos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna CPF, Email e Telefone mascarados para aluno maior de idade', async () => {
    const dataDeNascimentoAdulto = new Date();
    dataDeNascimentoAdulto.setFullYear(dataDeNascimentoAdulto.getFullYear() - 20); // 20 anos de idade

    mockTx.aluno.count.mockResolvedValueOnce(1);
    mockTx.aluno.findMany.mockResolvedValueOnce([
      {
        id: 'aluno-adulto',
        nome: 'Joao Adulto',
        email: 'joao@adulto.com',
        telefone: '92991234567',
        status: 'ATIVO',
        foto: null,
        updatedAt: new Date(),
        cpf: '11122233344',
        dataNasc: dataDeNascimentoAdulto,
        consentimentoImagem: false,
        dataConsentimentoImagem: null,
        isentoTaxaMatricula: false,
        bolsaDescontoPercent: null,
        tags: [],
        responsaveis: [],
      },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/alunos'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].cpf).toBe('***.***.***-44');
    expect(body.items[0].cpfMasked).toBe('***.***.***-44');
    expect(body.items[0].email).toBe('jo***@adulto.com');
    expect(body.items[0].emailMasked).toBe('jo***@adulto.com');
    expect(body.items[0].telefone).toBe('(**) *****-4567');
    expect(body.items[0].phoneMasked).toBe('(**) *****-4567');
  });

  it('retorna CPF, Email e Telefone do responsavel financeiro mascarado para aluno menor de idade', async () => {
    const dataDeNascimentoMenor = new Date();
    dataDeNascimentoMenor.setFullYear(dataDeNascimentoMenor.getFullYear() - 10); // 10 anos de idade

    mockTx.aluno.count.mockResolvedValueOnce(1);
    mockTx.aluno.findMany.mockResolvedValueOnce([
      {
        id: 'aluno-menor',
        nome: 'Maria Menor',
        email: 'maria@menor.com',
        telefone: '11988887777',
        status: 'ATIVO',
        foto: null,
        updatedAt: new Date(),
        cpf: '99999999999',
        dataNasc: dataDeNascimentoMenor,
        consentimentoImagem: false,
        dataConsentimentoImagem: null,
        isentoTaxaMatricula: false,
        bolsaDescontoPercent: null,
        tags: [],
        responsaveis: [
          {
            tipoVinculo: 'MAE',
            responsavel: {
              cpf: '88888888888',
              email: 'mae@exemplo.com',
              telefone: '11999998888',
              financeiro: false,
            },
          },
          {
            tipoVinculo: 'PAI',
            responsavel: {
              cpf: '77777777777',
              email: 'pai@exemplo.com',
              telefone: '92999997777',
              financeiro: true, // Responsavel financeiro preferencial
            },
          },
        ],
      },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/alunos'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    // Deve pegar os dados do pai (financeiro), mascarados
    expect(body.items[0].cpf).toBe('***.***.***-77');
    expect(body.items[0].cpfMasked).toBe('***.***.***-77');
    expect(body.items[0].email).toBe('pa***@exemplo.com');
    expect(body.items[0].emailMasked).toBe('pa***@exemplo.com');
    expect(body.items[0].telefone).toBe('(**) *****-7777');
    expect(body.items[0].phoneMasked).toBe('(**) *****-7777');
  });

  it('retorna dados do primeiro responsavel cadastrado se nao houver financeiro/principal explicito para menor', async () => {
    const dataDeNascimentoMenor = new Date();
    dataDeNascimentoMenor.setFullYear(dataDeNascimentoMenor.getFullYear() - 15);

    mockTx.aluno.count.mockResolvedValueOnce(1);
    mockTx.aluno.findMany.mockResolvedValueOnce([
      {
        id: 'aluno-menor',
        nome: 'Maria Menor 2',
        email: null,
        telefone: null,
        status: 'ATIVO',
        foto: null,
        updatedAt: new Date(),
        cpf: null,
        dataNasc: dataDeNascimentoMenor,
        consentimentoImagem: false,
        dataConsentimentoImagem: null,
        isentoTaxaMatricula: false,
        bolsaDescontoPercent: null,
        tags: [],
        responsaveis: [
          {
            tipoVinculo: 'TIO',
            responsavel: {
              cpf: '55555555555',
              email: 'tio@exemplo.com',
              telefone: '92991112222',
              financeiro: false,
            },
          },
        ],
      },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/alunos'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].cpf).toBe('***.***.***-55');
    expect(body.items[0].cpfMasked).toBe('***.***.***-55');
    expect(body.items[0].email).toBe('ti***@exemplo.com');
    expect(body.items[0].emailMasked).toBe('ti***@exemplo.com');
    expect(body.items[0].telefone).toBe('(**) *****-2222');
    expect(body.items[0].phoneMasked).toBe('(**) *****-2222');
  });
});
