import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getFinanceiroKpisFromAsaas } from '../get-financeiro-kpis-from-asaas';

vi.mock('../asaas-ops', () => ({
  listPayments: vi.fn(),
}));

describe('getFinanceiroKpisFromAsaas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve agregar KPIs a partir dos pagamentos oficiais do Asaas', async () => {
    const { listPayments } = await import('../asaas-ops');

    vi.mocked(listPayments)
      .mockResolvedValueOnce({
        hasMore: false,
        totalCount: 1,
        limit: 100,
        offset: 0,
        data: [
          {
            object: 'payment',
            id: 'pay_received',
            dateCreated: '2026-03-05',
            customer: 'cus_1',
            value: 120,
            netValue: 95,
            billingType: 'PIX',
            status: 'RECEIVED',
            dueDate: '2026-03-05',
            originalDueDate: '2026-03-05',
            paymentDate: '2026-03-05',
            deleted: false,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        hasMore: false,
        totalCount: 1,
        limit: 100,
        offset: 0,
        data: [
          {
            object: 'payment',
            id: 'pay_cash',
            dateCreated: '2026-03-06',
            customer: 'cus_2',
            value: 210,
            netValue: 210,
            billingType: 'BOLETO',
            status: 'RECEIVED_IN_CASH',
            dueDate: '2026-03-06',
            originalDueDate: '2026-03-06',
            paymentDate: '2026-03-06',
            deleted: false,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        hasMore: false,
        totalCount: 1,
        limit: 100,
        offset: 0,
        data: [
          {
            object: 'payment',
            id: 'pay_confirmed',
            dateCreated: '2026-03-07',
            customer: 'cus_3',
            value: 160,
            netValue: 142,
            billingType: 'PIX',
            status: 'CONFIRMED',
            dueDate: '2026-03-07',
            originalDueDate: '2026-03-07',
            deleted: false,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        hasMore: false,
        totalCount: 1,
        limit: 100,
        offset: 0,
        data: [
          {
            object: 'payment',
            id: 'pay_pending',
            dateCreated: '2026-03-08',
            customer: 'cus_1',
            value: 300,
            netValue: 300,
            billingType: 'PIX',
            status: 'PENDING',
            dueDate: '2026-03-20',
            originalDueDate: '2026-03-20',
            deleted: false,
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        hasMore: false,
        totalCount: 1,
        limit: 100,
        offset: 0,
        data: [
          {
            object: 'payment',
            id: 'pay_overdue',
            dateCreated: '2026-02-10',
            customer: 'cus_4',
            value: 100,
            netValue: 100,
            billingType: 'BOLETO',
            status: 'OVERDUE',
            dueDate: '2026-02-28',
            originalDueDate: '2026-02-28',
            deleted: false,
          },
        ],
      } as never);

    const result = await getFinanceiroKpisFromAsaas({
      contaId: 'conta-1',
      mesAtual: new Date('2026-03-01T00:00:00.000Z'),
      proximoMes: new Date('2026-04-01T00:00:00.000Z'),
      startOfToday: new Date('2026-03-10T00:00:00.000Z'),
      endOfNext30Days: new Date('2026-04-09T23:59:59.999Z'),
    });

    expect(result.data.recebidas.valorLiquido).toBe(95);
    expect(result.data.recebidasEmDinheiro.valorLiquido).toBe(210);
    expect(result.data.confirmadas.valorLiquido).toBe(142);
    expect(result.data.aguardandoPagamento.valorBruto).toBe(300);
    expect(result.data.vencidas.valorBruto).toBe(100);
    expect(result.data.receitaDoMes.valorLiquido).toBe(305);
    expect(result.data.resumo.totalReceitaReal).toBe(305);
    expect(result.data.resumo.totalAReceber).toBe(460);
    expect(result.data.resumo.totalInadimplente).toBe(100);
    expect(result.data.resumo.taxaInadimplencia).toBe(50);
    expect(result.paymentIdsForReconcile).toEqual([
      'pay_received',
      'pay_cash',
      'pay_confirmed',
      'pay_pending',
      'pay_overdue',
    ]);
  });

  it('falha explicitamente quando uma janela ainda tem mais pagamentos após o limite de páginas', async () => {
    const { listPayments } = await import('../asaas-ops');
    vi.mocked(listPayments).mockImplementation(async (filters, options) => ({
      object: 'list',
      totalCount: 2_001,
      offset: filters.offset ?? 0,
      limit: filters.limit ?? 100,
      hasMore: true,
      data: Array.from({ length: 100 }, (_, index) => ({
        object: 'payment', id: `pay-${options.contaId}-${filters.status}-${filters.offset}-${index}`,
        status: filters.status, value: 10, netValue: 10, customer: 'customer-1',
      })),
    } as never));

    await expect(getFinanceiroKpisFromAsaas({
      contaId: 'conta-kpi',
      mesAtual: new Date('2026-03-01T00:00:00.000Z'),
      proximoMes: new Date('2026-04-01T00:00:00.000Z'),
      startOfToday: new Date('2026-03-10T00:00:00.000Z'),
      endOfNext30Days: new Date('2026-04-09T23:59:59.999Z'),
    })).rejects.toThrow('ASAAS_PAYMENT_LOOKUP_INCOMPLETE:RECEIVED:max_pages_reached:20');

    expect(listPayments).toHaveBeenCalledWith(expect.objectContaining({ status: 'RECEIVED', offset: 1_900, limit: 100 }), { contaId: 'conta-kpi' });
  });

  it('não retorna snapshot com ID de payment vazio ou repetido entre páginas', async () => {
    const { listPayments } = await import('../asaas-ops');
    vi.mocked(listPayments).mockImplementation(async (filters) => {
      if (filters.status !== 'RECEIVED') {
        return { object: 'list', totalCount: 0, offset: 0, limit: 100, hasMore: false, data: [] } as never;
      }
      if (filters.offset === 0) {
        return {
          object: 'list', totalCount: 101, offset: 0, limit: 100, hasMore: true,
          data: Array.from({ length: 100 }, (_, index) => ({ object: 'payment', id: index === 0 ? 'payment-duplicate' : `payment-${index}`, status: 'RECEIVED', value: 10 })),
        } as never;
      }
      return {
        object: 'list', totalCount: 101, offset: 100, limit: 100, hasMore: false,
        data: [{ object: 'payment', id: 'payment-duplicate', status: 'RECEIVED', value: 10 }],
      } as never;
    });

    await expect(getFinanceiroKpisFromAsaas({
      contaId: 'conta-kpi',
      mesAtual: new Date('2026-03-01T00:00:00.000Z'),
      proximoMes: new Date('2026-04-01T00:00:00.000Z'),
      startOfToday: new Date('2026-03-10T00:00:00.000Z'),
      endOfNext30Days: new Date('2026-04-09T23:59:59.999Z'),
    })).rejects.toThrow('ASAAS_PAYMENT_LOOKUP_INCOMPLETE:RECEIVED:invalid_page1');
  });

  it('rejeita resposta com payment sem ID em vez de ignorá-lo nos totais', async () => {
    const { listPayments } = await import('../asaas-ops');
    vi.mocked(listPayments).mockImplementation(async (filters) => ({
      object: 'list', totalCount: 1, offset: filters.offset ?? 0, limit: 100,
      hasMore: false, data: filters.status === 'RECEIVED' ? [{ status: 'RECEIVED', value: 10 }] : [],
    } as never));

    await expect(getFinanceiroKpisFromAsaas({
      contaId: 'conta-kpi',
      mesAtual: new Date('2026-03-01T00:00:00.000Z'),
      proximoMes: new Date('2026-04-01T00:00:00.000Z'),
      startOfToday: new Date('2026-03-10T00:00:00.000Z'),
      endOfNext30Days: new Date('2026-04-09T23:59:59.999Z'),
    })).rejects.toThrow('ASAAS_PAYMENT_LOOKUP_INCOMPLETE:RECEIVED:invalid_page0');
  });

  it('falha fechado se o mesmo payment aparece em respostas de statuses diferentes', async () => {
    const { listPayments } = await import('../asaas-ops');
    vi.mocked(listPayments).mockImplementation(async (filters) => ({
      object: 'list', totalCount: filters.status === 'RECEIVED' || filters.status === 'CONFIRMED' ? 1 : 0,
      offset: 0, limit: 100, hasMore: false,
      data: filters.status === 'RECEIVED' || filters.status === 'CONFIRMED'
        ? [{ object: 'payment', id: 'payment-transitioning', status: filters.status, value: 100, netValue: 100 }]
        : [],
    } as never));

    await expect(getFinanceiroKpisFromAsaas({
      contaId: 'conta-kpi',
      mesAtual: new Date('2026-03-01T00:00:00.000Z'),
      proximoMes: new Date('2026-04-01T00:00:00.000Z'),
      startOfToday: new Date('2026-03-10T00:00:00.000Z'),
      endOfNext30Days: new Date('2026-04-09T23:59:59.999Z'),
    })).rejects.toThrow('ASAAS_PAYMENT_LOOKUP_INCONSISTENT:CROSS_STATUS_DUPLICATE:payment-transitioning:RECEIVED:CONFIRMED');
  });

  it.each([
    ['offset', 1, 100],
    ['limit', 0, 99],
  ])('falha fechado com %s inconsistente e sem produzir KPI parcial', async (_field, responseOffset, responseLimit) => {
    const { listPayments } = await import('../asaas-ops');
    vi.mocked(listPayments).mockResolvedValue({
      object: 'list', totalCount: 1, offset: responseOffset, limit: responseLimit,
      hasMore: false, data: [],
    } as never);

    await expect(getFinanceiroKpisFromAsaas({
      contaId: 'conta-kpi',
      mesAtual: new Date('2026-03-01T00:00:00.000Z'),
      proximoMes: new Date('2026-04-01T00:00:00.000Z'),
      startOfToday: new Date('2026-03-10T00:00:00.000Z'),
      endOfNext30Days: new Date('2026-04-09T23:59:59.999Z'),
    })).rejects.toThrow('ASAAS_PAYMENT_LOOKUP_INCOMPLETE:RECEIVED:invalid_page0');
  });
});
