import { describe, expect, it } from 'vitest';

import {
  calculateEventMetrics,
  isEventTicketLotOpenForSale,
  isEventCostExpectedStatus,
  isEventCostRealizedStatus,
  isEventRevenueExpectedStatus,
  isEventRevenueRealizedStatus,
  validateSchoolEventStatusTransition,
  validateTicketLotStatusTransition,
  validateTicketSaleStatusTransition,
} from './index';

describe('events domain rules', () => {
  it('applies lot status and inclusive sale window boundaries', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    expect(isEventTicketLotOpenForSale({ status: 'ACTIVE', saleStartsAt: new Date('2026-10-15T12:01:00.000Z') }, now)).toBe(false);
    expect(isEventTicketLotOpenForSale({ status: 'ACTIVE', saleStartsAt: new Date('2026-10-15T11:00:00.000Z'), saleEndsAt: new Date('2026-10-15T13:00:00.000Z') }, now)).toBe(true);
    expect(isEventTicketLotOpenForSale({ status: 'ACTIVE', saleEndsAt: new Date('2026-10-15T11:59:00.000Z') }, now)).toBe(false);
    expect(isEventTicketLotOpenForSale({ status: 'CLOSED' }, now)).toBe(false);
  });

  it('calcula previsto, realizado, resultado, ticket medio e ocupacao', () => {
    const metrics = calculateEventMetrics({
      ticketLots: [{ status: 'ACTIVE', quantityTotal: 100, quantitySold: 35 }],
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
    expect(metrics.ticketMedio).toBe(50);
    expect(metrics.taxaOcupacao).toBe(0.35);
    expect(metrics.cortesias).toBe(5);
    expect(metrics.figurinosPendentes).toBe(1);
    expect(metrics.figurinosEntregues).toBe(1);
    expect(metrics.figurinosDevolvidos).toBe(1);
  });

  it('expõe as classificações financeiras canônicas usadas pelos relatórios', () => {
    expect(isEventRevenueExpectedStatus('PENDING')).toBe(true);
    expect(isEventRevenueRealizedStatus('PENDING')).toBe(true);
    expect(isEventRevenueExpectedStatus('PAID')).toBe(false);
    expect(isEventRevenueRealizedStatus('PAID')).toBe(false);
    expect(isEventCostExpectedStatus('PARTIALLY_PAID')).toBe(true);
    expect(isEventCostRealizedStatus('PARTIALLY_PAID')).toBe(true);
    expect(isEventCostRealizedStatus('PARTIALLY_REFUNDED')).toBe(true);
    expect(isEventCostExpectedStatus('RECEIVED')).toBe(false);
    expect(isEventCostRealizedStatus('RECEIVED')).toBe(false);
  });

  it('usa status e valores realizados conforme a classificação canônica de receita e custo', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [
        { type: 'REVENUE', status: 'PENDING', expectedAmount: 50, actualAmount: 20, refundedAmount: 5, originType: 'MANUAL' },
        { type: 'REVENUE', status: 'PAID', expectedAmount: 30, actualAmount: 30, originType: 'MANUAL' },
        { type: 'COST', status: 'PARTIALLY_PAID', expectedAmount: 50, actualAmount: 15, originType: 'MANUAL' },
        { type: 'COST', status: 'RECEIVED', expectedAmount: 40, actualAmount: 40, originType: 'MANUAL' },
      ],
    });

    expect(metrics.receitaPrevista).toBe(50);
    expect(metrics.receitaRealizada).toBe(15);
    expect(metrics.custoPrevisto).toBe(50);
    expect(metrics.custoRealizado).toBe(15);
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

  it('inclui custos de figurino parcialmente pagos no realizado e desconta estornos', () => {
    const metrics = calculateEventMetrics({
      costumes: [{ id: 'costume-1', schoolCost: 1600, quantity: 1 }],
      financialEntries: [{
        id: 'costume-cost-1',
        type: 'COST',
        status: 'PARTIALLY_PAID',
        expectedAmount: 1600,
        actualAmount: 500,
        refundedAmount: 100,
        originType: 'COSTUME',
        originId: 'costume-1',
      }],
    });

    expect(metrics.custoPrevisto).toBe(1600);
    expect(metrics.custoRealizado).toBe(400);
  });

  it('mantém o custo realizado líquido para figurino parcialmente reembolsado', () => {
    const metrics = calculateEventMetrics({
      costumes: [{ id: 'costume-1', schoolCost: 100, quantity: 1 }],
      financialEntries: [{
        id: 'costume-cost-1',
        type: 'COST',
        status: 'PARTIALLY_REFUNDED',
        expectedAmount: 100,
        actualAmount: 100,
        refundedAmount: 30,
        originType: 'COSTUME',
        originId: 'costume-1',
      }],
    });

    expect(metrics.custoPrevisto).toBe(100);
    expect(metrics.custoRealizado).toBe(70);
  });

  it('inclui receita parcialmente paga no previsto e reconhece o realizado líquido de estornos', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [{
        type: 'REVENUE',
        status: 'PARTIALLY_PAID',
        expectedAmount: 1000,
        actualAmount: 400,
        refundedAmount: 50,
        originType: 'MANUAL',
      }],
    });

    expect(metrics.receitaPrevista).toBe(1000);
    expect(metrics.receitaRealizada).toBe(350);
    expect(metrics.saldoAReceber).toBe(650);
  });

  it('mantém a obrigação prevista após estorno parcial e calcula o saldo remanescente', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [{
        type: 'REVENUE', status: 'PARTIALLY_REFUNDED', expectedAmount: 90,
        actualAmount: 90, refundedAmount: 30, netAmount: 60, originType: 'MANUAL',
      }],
    });

    expect(metrics.receitaPrevista).toBe(90);
    expect(metrics.receitaRealizada).toBe(60);
    expect(metrics.saldoAReceber).toBe(30);
  });

  it('calcula o custo realizado líquido de estorno parcial e zera o estorno integral', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [
        { type: 'COST', status: 'PARTIALLY_REFUNDED', expectedAmount: 100, actualAmount: 100, refundedAmount: 30, originType: 'MANUAL' },
        { type: 'COST', status: 'REFUNDED', expectedAmount: 50, actualAmount: 50, refundedAmount: 50, originType: 'MANUAL' },
      ],
    });

    expect(metrics.custoRealizado).toBe(70);
    expect(metrics.resultadoRealizado).toBe(-70);
  });

  it('sinaliza custo cujo estorno excede o valor efetivamente pago', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [{
        id: 'cost-with-invalid-refund', originId: 'cost-with-invalid-refund', type: 'COST', status: 'PARTIALLY_REFUNDED',
        expectedAmount: 20, actualAmount: 10, refundedAmount: 15, originType: 'MANUAL',
      }],
    });

    expect(metrics.custoRealizado).toBe(0);
    expect(metrics.consistency.isConsistent).toBe(false);
    expect(metrics.consistency.issues).toContain('COST:cost-with-invalid-refund:refund_above_actual');
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

  it('desconta estorno parcial da receita realizada e do ticket medio sem misturar outras receitas', () => {
    const metrics = calculateEventMetrics({
      ticketSales: [{ status: 'PAID', quantity: 2, totalAmount: 100, refundedAmount: 25 }],
      financialEntries: [{
        type: 'REVENUE', status: 'RECEIVED', expectedAmount: 50, actualAmount: 50, originType: 'MANUAL',
      }],
    });

    expect(metrics.receitaRealizada).toBe(125);
    expect(metrics.receitaRecebidaBruta).toBe(150);
    expect(metrics.receitaEstornada).toBe(25);
    expect(metrics.receitaRecebidaLiquida).toBe(125);
    expect(metrics.saldoAReceber).toBe(25);
    expect(metrics.ticketMedio).toBe(37.5);
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

  it('mantém ingressos não vendidos como disponibilidade, sem incluí-los na receita prevista', () => {
    const metrics = calculateEventMetrics({
      ticketLots: [
        { status: 'ACTIVE', quantityTotal: 100, quantitySold: 30, unitPrice: 50 },
      ],
      ticketSales: [
        { status: 'PAID', quantity: 20, totalAmount: 1000 },
        { status: 'PENDING', quantity: 10, totalAmount: 500 },
      ],
    });

    // Only recorded paid and pending sales count; unsold inventory remains a separate metric.
    expect(metrics.receitaPrevista).toBe(1500);
    expect(metrics.receitaBrutaPrevista).toBe(1500);
    expect(metrics.receitaRealizada).toBe(1000);
    expect(metrics.saldoAReceber).toBe(500);
    expect(metrics.resultadoPrevisto).toBe(1500);
    expect(metrics.ingressosDisponiveis).toBe(70);
  });

  it('conta apenas lotes ACTIVE no inventário, sem projetar unidades não vendidas', () => {
    const inactiveStatuses = ['DRAFT', 'CLOSED', 'CANCELLED', 'ARCHIVED', 'SOLD_OUT'] as const;
    const metrics = calculateEventMetrics({
      ticketLots: [
        { status: 'ACTIVE', quantityTotal: 10, quantitySold: 2, unitPrice: 10 },
        ...inactiveStatuses.map((status) => ({ status, quantityTotal: 10, quantitySold: 2, unitPrice: 10 })),
      ],
      ticketSales: [{ status: 'PAID', quantity: 2, totalAmount: 100 }],
    });

    expect(metrics.ingressosDisponiveis).toBe(8);
    expect(metrics.receitaPrevista).toBe(100);
    expect(metrics.receitaRealizada).toBe(100);
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

  it('exclui receita cancelada ou estornada das previsões bruta e líquida sem alterar a realizada', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [
        { type: 'REVENUE', status: 'CANCELLED', expectedAmount: 80, grossAmount: 100, discountAmount: 20, actualAmount: 0, originType: 'MANUAL' },
        { type: 'REVENUE', status: 'REFUNDED', expectedAmount: 160, grossAmount: 200, discountAmount: 40, actualAmount: 200, refundedAmount: 200, originType: 'MANUAL' },
        { type: 'REVENUE', status: 'EXPECTED', expectedAmount: 80, grossAmount: 100, discountAmount: 20, actualAmount: 0, originType: 'MANUAL' },
        { type: 'REVENUE', status: 'PENDING', expectedAmount: 80, grossAmount: 100, discountAmount: 20, actualAmount: 0, originType: 'MANUAL' },
        { type: 'REVENUE', status: 'RECEIVED', expectedAmount: 80, grossAmount: 100, discountAmount: 20, actualAmount: 80, originType: 'MANUAL' },
        { type: 'REVENUE', status: 'PARTIALLY_PAID', expectedAmount: 80, grossAmount: 100, discountAmount: 20, actualAmount: 40, originType: 'MANUAL' },
        { type: 'REVENUE', status: 'PARTIALLY_REFUNDED', expectedAmount: 80, grossAmount: 100, discountAmount: 20, actualAmount: 80, refundedAmount: 20, originType: 'MANUAL' },
      ],
    });

    expect(metrics.receitaPrevista).toBe(400);
    expect(metrics.receitaBrutaPrevista).toBe(500);
    expect(metrics.descontosPrevistos).toBe(100);
    expect(metrics.receitaRealizada).toBe(180);
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

  it('contabiliza desembolso parcial como custo realizado sem quitar o saldo previsto', () => {
    const metrics = calculateEventMetrics({
      financialEntries: [{
        type: 'COST', status: 'PARTIALLY_PAID', expectedAmount: 500, actualAmount: 175,
        originType: 'MANUAL', costClass: 'DIRECT',
      }],
    });

    expect(metrics.custoPrevisto).toBe(500);
    expect(metrics.custoRealizado).toBe(175);
    expect(metrics.custoDiretoRealizado).toBe(175);
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
