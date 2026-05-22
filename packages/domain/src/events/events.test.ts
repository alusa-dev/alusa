import { describe, expect, it } from 'vitest';

import {
  calculateEventMetrics,
  validateSchoolEventStatusTransition,
  validateTicketLotStatusTransition,
  validateTicketSaleStatusTransition,
} from './index';

describe('events domain rules', () => {
  it('calcula previsto, realizado, resultado, ticket medio e ocupacao', () => {
    const metrics = calculateEventMetrics({
      ticketLots: [{ quantityTotal: 100, quantitySold: 35 }],
      ticketSales: [
        { status: 'PAID', quantity: 20, totalAmount: 1000 },
        { status: 'PENDING', quantity: 10, totalAmount: 500 },
        { status: 'COMPLIMENTARY', quantity: 5, totalAmount: 0 },
      ],
      financialEntries: [
        {
          type: 'COST',
          status: 'PAID',
          expectedAmount: 300,
          actualAmount: 250,
          originType: 'MANUAL',
        },
        {
          type: 'REVENUE',
          status: 'RECEIVED',
          expectedAmount: 200,
          actualAmount: 200,
          originType: 'MANUAL',
        },
      ],
      costumeAssignments: [
        { status: 'PENDING' },
        { status: 'DELIVERED' },
        { status: 'RETURNED' },
      ],
    });

    expect(metrics.receitaPrevista).toBe(1700);
    expect(metrics.receitaRealizada).toBe(1200);
    expect(metrics.custoPrevisto).toBe(300);
    expect(metrics.custoRealizado).toBe(250);
    expect(metrics.resultadoPrevisto).toBe(1400);
    expect(metrics.resultadoRealizado).toBe(950);
    expect(metrics.ticketMedio).toBe(60);
    expect(metrics.taxaOcupacao).toBe(0.35);
    expect(metrics.cortesias).toBe(5);
    expect(metrics.figurinosPendentes).toBe(1);
    expect(metrics.figurinosEntregues).toBe(1);
    expect(metrics.figurinosDevolvidos).toBe(1);
  });

  it('ignora receitas financeiras automaticas para nao duplicar vendas', () => {
    const metrics = calculateEventMetrics({
      ticketSales: [{ status: 'PAID', quantity: 1, totalAmount: 100 }],
      financialEntries: [
        {
          type: 'REVENUE',
          status: 'RECEIVED',
          expectedAmount: 100,
          actualAmount: 100,
          originType: 'TICKET_SALE',
        },
      ],
    });

    expect(metrics.receitaPrevista).toBe(100);
    expect(metrics.receitaRealizada).toBe(100);
  });

  it('bloqueia transicoes operacionais invalidas', () => {
    expect(validateSchoolEventStatusTransition('FINISHED', 'ACTIVE').ok).toBe(false);
    expect(validateSchoolEventStatusTransition('PLANNING', 'ACTIVE').ok).toBe(true);
    expect(validateTicketLotStatusTransition('CANCELLED', 'ACTIVE').ok).toBe(false);
    expect(validateTicketSaleStatusTransition('PAID', 'REFUNDED').ok).toBe(true);
  });
});
