import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { Prisma, FormaPagamento, StatusCobranca } from '@prisma/client';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { GET } from '@/app/api/conta/forma-pagamento/route';

const buildRequest = (url: string): NextRequest => new Request(url) as unknown as NextRequest;

describe('GET /api/conta/forma-pagamento', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna forma de pagamento por aluno usando a próxima cobrança', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1', role: 'RESPONSAVEL', contaId: 'conta-1' },
    });

    vi.spyOn(prisma.responsavel, 'findFirst').mockResolvedValue({
      id: 'resp-1',
      nome: 'Responsável Teste',
      email: 'responsavel@example.com',
      preferredBillingType: 'CARTAO_CREDITO',
    } as never);

    vi.spyOn(prisma.matricula, 'findMany').mockResolvedValue([
      {
        id: 'mat-1',
        asaasSubscriptionId: 'sub-1',
        formaPagamentoTaxa: FormaPagamento.CARTAO_CREDITO,
        responsavelFinanceiroId: 'resp-1',
        status: 'ATIVA',
        responsavelFinanceiro: {
          id: 'resp-1',
          nome: 'Responsável Teste',
          email: 'responsavel@example.com',
          preferredBillingType: 'CARTAO_CREDITO',
        },
        aluno: { nome: 'Aluno 1', cpf: '12345678900', responsaveis: [] },
        plano: { nome: 'Plano 1' },
        cobrancas: [
          {
            id: 'cob-1',
            status: StatusCobranca.PENDENTE,
            vencimento: new Date('2025-01-10T00:00:00.000Z'),
            valor: new Prisma.Decimal('350.50'),
            formaPagamento: FormaPagamento.PIX,
          },
        ],
      },
    ] as never);

    const res = await GET(buildRequest('http://localhost/api/conta/forma-pagamento'));
    expect(res.status).toBe(200);

    const payload = await res.json();
    expect(payload.assinaturas).toHaveLength(1);
    expect(payload.assinaturas[0].aluno).toBe('Aluno 1');
    expect(payload.assinaturas[0].formaPagamento).toBe('PIX');
    expect(payload.assinaturas[0].proximaCobranca.valor).toBeCloseTo(350.5);
  });

  it('usa fallback quando não há cobranças ativas', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1', role: 'RESPONSAVEL', contaId: 'conta-1' },
    });

    vi.spyOn(prisma.responsavel, 'findFirst').mockResolvedValue({
      id: 'resp-1',
      nome: 'Responsável Teste',
      email: 'responsavel@example.com',
      preferredBillingType: 'BOLETO',
    } as never);

    vi.spyOn(prisma.matricula, 'findMany').mockResolvedValue([
      {
        id: 'mat-1',
        asaasSubscriptionId: 'sub-1',
        formaPagamentoTaxa: FormaPagamento.PIX,
        responsavelFinanceiroId: 'resp-1',
        status: 'ATIVA',
        responsavelFinanceiro: {
          id: 'resp-1',
          nome: 'Responsável Teste',
          email: 'responsavel@example.com',
          preferredBillingType: 'BOLETO',
        },
        aluno: { nome: 'Aluno 1', cpf: '12345678900', responsaveis: [] },
        plano: { nome: 'Plano 1' },
        cobrancas: [],
      },
    ] as never);

    const res = await GET(buildRequest('http://localhost/api/conta/forma-pagamento'));
    expect(res.status).toBe(200);

    const payload = await res.json();
    expect(payload.assinaturas[0].formaPagamento).toBe('PIX');
    expect(payload.assinaturas[0].proximaCobranca).toBeNull();
  });

  it('retorna matrículas vinculadas pela relação aluno-responsável mesmo sem responsável financeiro direto', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1', role: 'RESPONSAVEL', contaId: 'conta-1' },
    });

    vi.spyOn(prisma.responsavel, 'findFirst').mockResolvedValue({
      id: 'resp-1',
      nome: 'Responsável Teste',
      email: 'responsavel@example.com',
      preferredBillingType: 'PIX',
    } as never);

    vi.spyOn(prisma.matricula, 'findMany').mockResolvedValue([
      {
        id: 'mat-3',
        asaasSubscriptionId: null,
        formaPagamentoTaxa: null,
        responsavelFinanceiroId: null,
        status: 'ATIVA',
        responsavelFinanceiro: null,
        aluno: {
          nome: 'Aluno Relacionado',
          cpf: '11122233344',
          responsaveis: [
            {
              responsavel: {
                id: 'resp-1',
                nome: 'Responsável Teste',
                email: 'responsavel@example.com',
                preferredBillingType: 'PIX',
              },
            },
          ],
        },
        plano: { nome: 'Plano Relacionado' },
        cobrancas: [],
      },
    ] as never);

    const res = await GET(buildRequest('http://localhost/api/conta/forma-pagamento'));
    expect(res.status).toBe(200);

    const payload = await res.json();
    expect(payload.assinaturas).toHaveLength(1);
    expect(payload.assinaturas[0].aluno).toBe('Aluno Relacionado');
    expect(payload.assinaturas[0].formaPagamento).toBe('PIX');
  });

  it('permite acesso para alunos exibindo apenas suas matrículas', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-2', role: 'ALUNO', contaId: 'conta-1' },
    });

    vi.spyOn(prisma.aluno, 'findFirst').mockResolvedValue({ id: 'aluno-1' } as never);

    vi.spyOn(prisma.matricula, 'findMany').mockResolvedValue([
      {
        id: 'mat-1',
        asaasSubscriptionId: null,
        formaPagamentoTaxa: FormaPagamento.BOLETO,
        responsavelFinanceiroId: 'resp-2',
        status: 'ATIVA',
        responsavelFinanceiro: {
          id: 'resp-2',
          nome: 'Responsável Financeiro',
          email: 'financeiro@example.com',
          preferredBillingType: 'BOLETO',
        },
        aluno: { nome: 'Aluno Portal', cpf: '55566677788', responsaveis: [] },
        plano: { nome: 'Plano Dança' },
        cobrancas: [],
      },
    ] as never);

    const res = await GET(buildRequest('http://localhost/api/conta/forma-pagamento'));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.responsavel.nome).toBe('Responsável Financeiro');
    expect(payload.assinaturas).toHaveLength(1);
    expect(payload.assinaturas[0].aluno).toBe('Aluno Portal');
    expect(payload.assinaturas[0].formaPagamento).toBe('BOLETO');
  });
});
