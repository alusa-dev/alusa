import { describe, expect, it, vi } from 'vitest';

import { getMobileBillingSummary } from '../use-cases/get-mobile-billing-summary';

describe('getMobileBillingSummary', () => {
  it('agrupa cobranças acadêmicas por status e período', async () => {
    const db = {
      cobranca: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'received',
            valor: 120,
            valorFinal: null,
            asaasValue: 120,
            asaasStatus: 'RECEIVED',
            asaasNetValue: 115,
            status: 'PAGO',
            liquidacaoStatus: 'DISPONIVEL',
            vencimento: new Date('2026-09-05T00:00:00.000Z'),
            dataPagamento: new Date('2026-09-08T10:00:00.000Z'),
            pagoEm: null,
            updatedAt: new Date('2026-09-08T10:00:00.000Z'),
          },
          {
            id: 'confirmed',
            valor: 80,
            valorFinal: null,
            asaasValue: 80,
            asaasStatus: 'CONFIRMED',
            asaasNetValue: 78,
            status: 'PAGO',
            liquidacaoStatus: 'PENDENTE',
            vencimento: new Date('2026-09-20T00:00:00.000Z'),
            dataPagamento: null,
            pagoEm: null,
            updatedAt: new Date('2026-09-09T10:00:00.000Z'),
          },
          {
            id: 'overdue',
            valor: 40,
            valorFinal: null,
            asaasValue: 40,
            asaasStatus: 'OVERDUE',
            asaasNetValue: null,
            status: 'ATRASADO',
            liquidacaoStatus: 'NAO_APLICAVEL',
            vencimento: new Date('2026-09-01T00:00:00.000Z'),
            dataPagamento: null,
            pagoEm: null,
            updatedAt: new Date('2026-09-01T10:00:00.000Z'),
          },
        ]),
      },
      charge: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await getMobileBillingSummary({
      contaId: 'conta-1',
      period: 'THIS_MONTH',
      now: new Date('2026-09-10T12:00:00.000Z'),
      db: db as never,
    });

    expect(result).toMatchObject({
      received: { count: 1, amount: 120 },
      confirmed: { count: 1, amount: 80 },
      awaitingPayment: { count: 0, amount: 0 },
      overdue: { count: 1, amount: 40 },
    });
  });

  it('não mistura uma cobrança paga antiga no período de 30 dias', async () => {
    const db = {
      cobranca: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'old',
          valor: 10,
          valorFinal: null,
          asaasValue: 10,
          asaasStatus: 'RECEIVED',
          asaasNetValue: 10,
          status: 'PAGO',
          liquidacaoStatus: 'DISPONIVEL',
          vencimento: new Date('2026-07-01T00:00:00.000Z'),
          dataPagamento: new Date('2026-07-01T10:00:00.000Z'),
          pagoEm: null,
          updatedAt: new Date('2026-07-01T10:00:00.000Z'),
        }]),
      },
      charge: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await getMobileBillingSummary({
      contaId: 'conta-1',
      period: 'LAST_30_DAYS',
      now: new Date('2026-09-10T12:00:00.000Z'),
      db: db as never,
    });

    expect(result.received).toEqual({ count: 0, amount: 0 });
  });
});
