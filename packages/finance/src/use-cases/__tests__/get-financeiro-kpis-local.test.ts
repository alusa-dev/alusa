import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  cobranca: { findMany: vi.fn() },
  charge: { findMany: vi.fn() },
}));

vi.mock('@alusa/database', () => ({
  prisma: prismaMock,
}));

import { getFinanceiroKpisLocal } from '../get-financeiro-kpis-local';

describe('getFinanceiroKpisLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calcula KPIs locais sem consultar Asaas', async () => {
    const mesAtual = new Date('2026-03-01T00:00:00.000Z');
    const proximoMes = new Date('2026-04-01T00:00:00.000Z');
    const startOfToday = new Date('2026-03-10T00:00:00.000Z');
    const endOfNext30Days = new Date('2026-04-09T23:59:59.999Z');

    prismaMock.cobranca.findMany.mockResolvedValue([
      {
        id: 'cob-1',
        valor: 120,
        valorFinal: null,
        dataPagamento: new Date('2026-03-12T10:00:00.000Z'),
        pagoEm: null,
        updatedAt: new Date('2026-03-12T10:00:00.000Z'),
        vencimento: new Date('2026-03-05T00:00:00.000Z'),
        status: 'PAGO',
        formaPagamento: 'PIX',
        asaasStatus: 'RECEIVED',
        asaasValue: 120,
        asaasNetValue: 115,
        liquidacaoStatus: 'DISPONIVEL',
        matricula: { alunoId: 'aluno-1' },
      },
      {
        id: 'cob-2',
        valor: 60,
        valorFinal: null,
        dataPagamento: null,
        pagoEm: null,
        updatedAt: new Date('2026-03-15T10:00:00.000Z'),
        vencimento: new Date('2026-03-20T00:00:00.000Z'),
        status: 'PAGO',
        formaPagamento: 'PIX',
        asaasStatus: 'CONFIRMED',
        asaasValue: 60,
        asaasNetValue: 57,
        liquidacaoStatus: 'PENDENTE',
        matricula: { alunoId: 'aluno-2' },
      },
      {
        id: 'cob-old-paid',
        valor: 999,
        valorFinal: null,
        dataPagamento: new Date('2026-02-12T10:00:00.000Z'),
        pagoEm: null,
        updatedAt: new Date('2026-02-12T10:00:00.000Z'),
        vencimento: new Date('2026-02-05T00:00:00.000Z'),
        status: 'PAGO',
        formaPagamento: 'PIX',
        asaasStatus: 'RECEIVED',
        asaasValue: 999,
        asaasNetValue: 990,
        liquidacaoStatus: 'DISPONIVEL',
        matricula: { alunoId: 'aluno-old' },
      },
      {
        id: 'cob-3',
        valor: 300,
        valorFinal: null,
        dataPagamento: null,
        pagoEm: null,
        updatedAt: new Date('2026-03-10T10:00:00.000Z'),
        vencimento: new Date('2026-03-25T00:00:00.000Z'),
        status: 'PENDENTE',
        formaPagamento: 'BOLETO',
        asaasStatus: 'PENDING',
        asaasValue: 300,
        asaasNetValue: null,
        liquidacaoStatus: 'NAO_APLICAVEL',
        matricula: { alunoId: 'aluno-3' },
      },
    ]);

    prismaMock.charge.findMany.mockResolvedValue([
      {
        id: 'chg-1',
        value: 80,
        updatedAt: new Date('2026-03-18T10:00:00.000Z'),
        statusUpdatedAt: new Date('2026-03-18T10:00:00.000Z'),
        dueDate: new Date('2026-03-18T00:00:00.000Z'),
        status: 'PAID',
        asaasStatus: 'RECEIVED_IN_CASH',
        asaasValue: 80,
        asaasNetValue: 80,
        liquidacaoStatus: 'DISPONIVEL',
        liquidadoEm: new Date('2026-03-18T10:00:00.000Z'),
        billingType: 'RECEIVED_IN_CASH',
        customerId: 'cus-1',
        payerName: 'Responsavel',
      },
      {
        id: 'chg-2',
        value: 90,
        updatedAt: new Date('2026-03-01T10:00:00.000Z'),
        statusUpdatedAt: new Date('2026-03-01T10:00:00.000Z'),
        dueDate: new Date('2026-03-01T00:00:00.000Z'),
        status: 'OVERDUE',
        asaasStatus: 'OVERDUE',
        asaasValue: 90,
        asaasNetValue: null,
        liquidacaoStatus: 'NAO_APLICAVEL',
        liquidadoEm: null,
        billingType: 'PIX',
        customerId: 'cus-2',
        payerName: 'Aluno',
      },
    ]);

    const result = await getFinanceiroKpisLocal({
      contaId: 'conta-1',
      mesAtual,
      proximoMes,
      startOfToday,
      endOfNext30Days,
    });

    expect(result.data.recebidas).toMatchObject({
      valorBruto: 120,
      valorLiquido: 115,
      quantidadeDeCobrancas: 1,
      quantidadeDeClientes: 1,
    });
    expect(result.data.recebidasEmDinheiro.valorBruto).toBe(80);
    expect(result.data.confirmadas.valorLiquido).toBe(57);
    expect(result.data.aguardandoPagamento.valorBruto).toBe(300);
    expect(result.data.vencidas.valorBruto).toBe(90);
    expect(result.data.receitaDoMes.valorLiquido).toBe(195);
    expect(result.data.resumo).toMatchObject({
      totalReceitaReal: 195,
      totalAReceber: 360,
      totalInadimplente: 90,
      taxaInadimplencia: 50,
    });
  });

  it('deduplica chamadas concorrentes com a mesma chave', async () => {
    const mesAtual = new Date('2026-03-01T00:00:00.000Z');
    const proximoMes = new Date('2026-04-01T00:00:00.000Z');
    const startOfToday = new Date('2026-03-10T00:00:00.000Z');
    const endOfNext30Days = new Date('2026-04-09T23:59:59.999Z');

    prismaMock.cobranca.findMany.mockResolvedValue([]);
    prismaMock.charge.findMany.mockResolvedValue([]);

    const input = {
      contaId: 'conta-1',
      mesAtual,
      proximoMes,
      startOfToday,
      endOfNext30Days,
    };

    const [first, second] = await Promise.all([
      getFinanceiroKpisLocal(input),
      getFinanceiroKpisLocal(input),
    ]);

    expect(first).toEqual(second);
    expect(prismaMock.cobranca.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.charge.findMany).toHaveBeenCalledTimes(1);
  });
});
