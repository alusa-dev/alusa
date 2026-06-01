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
    expect(metrics.lucroBrutoPrevisto).toBe(1700);
    expect(metrics.lucroBrutoRealizado).toBe(1200);
    expect(metrics.lucroLiquidoPrevisto).toBe(1400);
    expect(metrics.lucroLiquidoRealizado).toBe(950);
    expect(metrics.ticketMedio).toBe(60);
    expect(metrics.taxaOcupacao).toBe(0.35);
    expect(metrics.cortesias).toBe(5);
    expect(metrics.figurinosPendentes).toBe(1);
    expect(metrics.figurinosEntregues).toBe(1);
    expect(metrics.figurinosDevolvidos).toBe(1);
  });

  it('calcula corretamente figurinos, custos diretos/indiretos e estornos', () => {
    const metrics = calculateEventMetrics({
      ticketLots: [],
      ticketSales: [
        { status: 'PAID', quantity: 1, totalAmount: 100 },
        { status: 'REFUNDED', quantity: 1, totalAmount: 100 }, // should be 0 revenue and NOT subtract from PAID
      ],
      costumes: [
        { schoolCost: 50, quantity: 1 }, // Direct Cost: 50
      ],
      financialEntries: [
        {
          type: 'COST',
          status: 'PAID',
          expectedAmount: 30,
          actualAmount: 30,
          originType: 'MANUAL', // Indirect Cost
        },
        {
          type: 'REVENUE',
          status: 'REFUNDED', // should be 0 revenue and NOT subtract from PAID
          expectedAmount: 20,
          actualAmount: 20,
          originType: 'MANUAL',
        },
      ],
      costumeAssignments: [
        { status: 'DELIVERED', chargedValue: 40, isPaid: true }, // Revenue
        { status: 'PENDING', chargedValue: 30, isPaid: false }, // Expected Revenue
        { status: 'CANCELLED', chargedValue: 30, isPaid: false }, // Ignored
      ],
    });

    // Receita Prevista = Ticket Sale (100) + Costume Assigned Paid (40) + Costume Assigned Pending (30) = 170
    expect(metrics.receitaPrevista).toBe(170);
    // Receita Realizada = Ticket Sale (100) + Costume Assigned Paid (40) = 140
    expect(metrics.receitaRealizada).toBe(140);
    // Custo Previsto = Costume Cost (50) + Manual Cost (30) = 80
    expect(metrics.custoPrevisto).toBe(80);
    // Custo Realizado = Costume Cost (50) + Manual Cost (30) = 80
    expect(metrics.custoRealizado).toBe(80);
    // Lucro Bruto Previsto = Receita Prevista (170) - Custo Direto Previsto (50) = 120
    expect(metrics.lucroBrutoPrevisto).toBe(120);
    // Lucro Bruto Realizado = Receita Realizada (140) - Custo Direto Realizado (50) = 90
    expect(metrics.lucroBrutoRealizado).toBe(90);
    // Lucro Líquido Previsto = Receita Prevista (170) - Custo Previsto (80) = 90
    expect(metrics.lucroLiquidoPrevisto).toBe(90);
    // Lucro Líquido Realizado = Receita Realizada (140) - Custo Realizado (80) = 60
    expect(metrics.lucroLiquidoRealizado).toBe(60);
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

  it('calcula receita prevista incluindo ingressos potenciais nao vendidos do lote', () => {
    const metrics = calculateEventMetrics({
      ticketLots: [
        { quantityTotal: 100, quantitySold: 30, unitPrice: 50 }, // 70 unsold * 50 = 3500 potential
      ],
      ticketSales: [
        { status: 'PAID', quantity: 20, totalAmount: 1000 },
        { status: 'PENDING', quantity: 10, totalAmount: 500 },
      ],
    });

    // 1000 (PAID sales) + 500 (PENDING sales) + (100 - 30) * 50 (unsold potential) = 1500 + 3500 = 5000
    expect(metrics.receitaPrevista).toBe(5000);
  });

  it('bloqueia transicoes operacionais invalidas', () => {
    expect(validateSchoolEventStatusTransition('FINISHED', 'ACTIVE').ok).toBe(true);
    expect(validateSchoolEventStatusTransition('FINISHED', 'PLANNING').ok).toBe(false);
    expect(validateSchoolEventStatusTransition('PLANNING', 'ACTIVE').ok).toBe(true);
    expect(validateTicketLotStatusTransition('CANCELLED', 'ACTIVE').ok).toBe(false);
    expect(validateTicketSaleStatusTransition('PAID', 'REFUNDED').ok).toBe(true);
  });
});
