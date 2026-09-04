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
    expect(metrics.saldoAReceber).toBe(500);
    expect(metrics.custoPrevisto).toBe(300);
    expect(metrics.custoRealizado).toBe(250);
    expect(metrics.resultadoPrevisto).toBe(1400);
    expect(metrics.resultadoRealizado).toBe(950);
    expect(metrics.lucroBrutoPrevisto).toBe(1400);
    expect(metrics.lucroBrutoRealizado).toBe(950);
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
        { status: 'DELIVERED', billingMode: 'SEPARATE_CHARGE', chargedValue: 40, isPaid: true }, // Revenue
        { status: 'PENDING', billingMode: 'SEPARATE_CHARGE', chargedValue: 30, isPaid: false }, // Expected Revenue
        { status: 'DELIVERED', billingMode: 'INCLUDED_IN_REGISTRATION_FEE', chargedValue: 80, isPaid: true }, // Included in fee, no duplicate revenue
        { status: 'CANCELLED', billingMode: 'SEPARATE_CHARGE', chargedValue: 30, isPaid: false }, // Ignored
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
    // Lucro Bruto desconta todos os custos operacionais relacionados ao evento.
    expect(metrics.lucroBrutoPrevisto).toBe(90);
    expect(metrics.lucroBrutoRealizado).toBe(60);
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

  it('soma no realizado apenas valores financeiros realmente recebidos', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [
        {
          type: 'REVENUE',
          status: 'RECEIVED',
          expectedAmount: 650,
          actualAmount: null,
          originType: 'MANUAL',
        },
        {
          type: 'REVENUE',
          status: 'PENDING',
          expectedAmount: 650,
          actualAmount: 325,
          originType: 'MANUAL',
        },
      ],
    });

    expect(metrics.receitaPrevista).toBe(1300);
    expect(metrics.receitaRealizada).toBe(325);
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

  it('mantém receita realizada zerada quando todas as inscrições estão pendentes', () => {
    const metrics = calculateEventMetrics({
      financialEntries: Array.from({ length: 27 }, () => ({
        type: 'REVENUE' as const,
        status: 'PENDING' as const,
        expectedAmount: 353.5,
        grossAmount: 780,
        discountAmount: 426.5,
        actualAmount: null,
        originType: 'MANUAL' as const,
      })),
    });

    expect(metrics.receitaBrutaPrevista).toBe(21060);
    expect(metrics.descontosPrevistos).toBe(11515.5);
    expect(metrics.receitaPrevista).toBe(9544.5);
    expect(metrics.receitaRealizada).toBe(0);
    expect(metrics.resultadoRealizado).toBe(0);
    expect(metrics.consistency.isConsistent).toBe(true);
  });

  it('inclui obrigações antigas sem lançamento local sem duplicar entradas vinculadas', () => {
    const metrics = calculateEventMetrics({
      participantObligations: [
        {
          id: 'legacy-participant',
          grossAmount: 780,
          discountAmount: 426.5,
          expectedAmount: 353.5,
          actualAmount: null,
        },
        {
          id: 'linked-participant',
          revenueEntryId: 'entry-1',
          grossAmount: 780,
          discountAmount: 78,
          expectedAmount: 702,
          actualAmount: null,
        },
      ],
      financialEntries: [{
        id: 'entry-1',
        type: 'REVENUE',
        status: 'PENDING',
        expectedAmount: 702,
        grossAmount: 780,
        discountAmount: 78,
        actualAmount: null,
        originType: 'MANUAL',
      }],
    });

    expect(metrics.receitaPrevista).toBe(1055.5);
    expect(metrics.receitaBrutaPrevista).toBe(1560);
    expect(metrics.descontosPrevistos).toBe(504.5);
  });

  it('mantém a obrigação do participante e isola receita manual sem vínculo', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [{
        id: 'manual-unlinked',
        type: 'REVENUE',
        status: 'RECEIVED',
        expectedAmount: 780,
        actualAmount: 780,
        originType: 'MANUAL',
        category: 'Taxa de inscrição',
      }],
      participantObligations: [{
        id: 'legacy-participant',
        revenueEntryId: null,
        grossAmount: 780,
        discountAmount: 0,
        expectedAmount: 780,
        actualAmount: 0,
      }],
    });

    expect(metrics.receitaPrevista).toBe(780);
    expect(metrics.receitaRealizada).toBe(0);
    expect(metrics.saldoAReceber).toBe(780);
    expect(metrics.consistency.isConsistent).toBe(false);
    expect(metrics.consistency.issues).toEqual(expect.arrayContaining([
      'REVENUE:manual-unlinked:unlinked_manual_entry',
    ]));
  });

  it('calcula o saldo a receber pelo previsto menos o realizado', () => {
    const pending = calculateEventMetrics({
      participantObligations: [{
        id: 'pending-participant',
        grossAmount: 780,
        discountAmount: 0,
        expectedAmount: 780,
        actualAmount: null,
      }],
    });
    const partial = calculateEventMetrics({
      participantObligations: [{
        id: 'partial-participant',
        grossAmount: 780,
        discountAmount: 0,
        expectedAmount: 780,
        actualAmount: 80,
      }],
    });

    expect(pending.receitaPrevista).toBe(780);
    expect(pending.receitaRealizada).toBe(0);
    expect(pending.saldoAReceber).toBe(780);
    expect(partial.receitaPrevista).toBe(780);
    expect(partial.receitaRealizada).toBe(80);
    expect(partial.saldoAReceber).toBe(700);
  });

  it('separa lucro bruto de resultado líquido por classe de custo', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [
        {
          type: 'REVENUE', status: 'RECEIVED', expectedAmount: 1000, actualAmount: 1000,
          originType: 'MANUAL', grossAmount: 1000, discountAmount: 0,
        },
        {
          type: 'COST', status: 'PAID', expectedAmount: 300, actualAmount: 300,
          originType: 'MANUAL', costClass: 'DIRECT',
        },
        {
          type: 'COST', status: 'PAID', expectedAmount: 100, actualAmount: 100,
          originType: 'MANUAL', costClass: 'FINANCIAL',
        },
      ],
    });

    expect(metrics.lucroBrutoRealizado).toBe(700);
    expect(metrics.lucroLiquidoRealizado).toBe(600);
    expect(metrics.taxasFinanceirasRealizadas).toBe(100);
  });

  it('não reconhece como pago um custo de figurino pendente', () => {
    const metrics = calculateEventMetrics({
      costumes: [{ id: 'costume-1', schoolCost: 500, quantity: 1 }],
      financialEntries: [{
        type: 'COST', status: 'PENDING', expectedAmount: 500, actualAmount: null,
        originType: 'COSTUME', originId: 'costume-1', costClass: 'DIRECT',
      }],
    });

    expect(metrics.custoPrevisto).toBe(500);
    expect(metrics.custoRealizado).toBe(0);
  });

  it('bloqueia transicoes operacionais invalidas', () => {
    expect(validateSchoolEventStatusTransition('FINISHED', 'ACTIVE').ok).toBe(true);
    expect(validateSchoolEventStatusTransition('FINISHED', 'PLANNING').ok).toBe(false);
    expect(validateSchoolEventStatusTransition('PLANNING', 'ACTIVE').ok).toBe(true);
    expect(validateTicketLotStatusTransition('CANCELLED', 'ACTIVE').ok).toBe(false);
    expect(validateTicketSaleStatusTransition('PAID', 'REFUNDED').ok).toBe(true);
  });
});
