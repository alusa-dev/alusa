import { describe, expect, it } from 'vitest';

import {
  normalizePaymentHistoryCategory,
  PAYMENT_HISTORY_CATEGORY_LABELS,
  resolvePaymentHistoryDetailHref,
  resolveStandalonePaymentHistoryTipo,
} from '@/features/financeiro/pagamentos/payment-history-categories';

describe('payment-history-categories', () => {
  it('normaliza tipos academicos e standalone para categorias canonicas', () => {
    expect(normalizePaymentHistoryCategory({ tipo: 'TAXA_MATRICULA' })).toBe('TAXA_MATRICULA');
    expect(normalizePaymentHistoryCategory({ tipo: 'MENSALIDADE' })).toBe('MENSALIDADE');
    expect(normalizePaymentHistoryCategory({ tipo: 'PARCELADA' })).toBe('PARCELAMENTO');
    expect(normalizePaymentHistoryCategory({ sourceKind: 'charge', chargeType: 'INSTALLMENT' })).toBe('PARCELAMENTO');
    expect(normalizePaymentHistoryCategory({ tipo: 'RECORRENTE' })).toBe('ASSINATURA');
    expect(normalizePaymentHistoryCategory({ sourceKind: 'charge', chargeType: 'SUBSCRIPTION' })).toBe('ASSINATURA');
    expect(normalizePaymentHistoryCategory({ tipo: 'LOJA', origin: 'LOJA' })).toBe('LOJA');
    expect(normalizePaymentHistoryCategory({ sourceKind: 'sale', tipo: 'LOJA' })).toBe('LOJA');
    expect(normalizePaymentHistoryCategory({ sourceKind: 'event_ticket_sale', origin: 'EVENTOS' })).toBe('EVENTOS');
    expect(normalizePaymentHistoryCategory({ sourceKind: 'event_map_order', origin: 'EVENTOS' })).toBe('EVENTOS');
    expect(
      normalizePaymentHistoryCategory({ sourceKind: 'event_financial_entry', originType: 'COSTUME_ASSIGNMENT' }),
    ).toBe('EVENTOS');
    expect(normalizePaymentHistoryCategory({ tipo: 'AVULSA' })).toBe('OUTROS');
    expect(
      normalizePaymentHistoryCategory({
        tipo: 'AVULSA',
        description: 'Taxa de matrícula familiar · Vera · 2 alunos',
        familyGroupId: 'family-1',
      }),
    ).toBe('TAXA_MATRICULA');
    expect(
      normalizePaymentHistoryCategory({
        sourceKind: 'charge',
        chargeType: 'ONE_TIME',
        externalReference: 'event-entry:entry-1',
      }),
    ).toBe('EVENTOS');
  });

  it('classifica cobranca standalone familiar como taxa de matricula', () => {
    expect(
      resolveStandalonePaymentHistoryTipo({
        chargeType: 'ONE_TIME',
        hasSale: false,
        familyGroupId: 'family-1',
        description: 'Taxa de matrícula familiar · Vera · 2 alunos',
      }),
    ).toBe('TAXA_MATRICULA');
  });

  it('expoe labels amigaveis para as secoes principais', () => {
    expect(PAYMENT_HISTORY_CATEGORY_LABELS.MENSALIDADE).toBe('Mensalidades');
    expect(PAYMENT_HISTORY_CATEGORY_LABELS.PARCELAMENTO).toBe('Parcelamentos');
    expect(PAYMENT_HISTORY_CATEGORY_LABELS.ASSINATURA).toBe('Assinaturas');
    expect(PAYMENT_HISTORY_CATEGORY_LABELS.EVENTOS).toBe('Eventos');
  });

  it('resolve href de detalhe por origem', () => {
    expect(
      resolvePaymentHistoryDetailHref({
        sourceKind: 'sale',
        sourceId: 'sale-1',
        category: 'LOJA',
      }),
    ).toBe('/vendas/sale-1');

    expect(
      resolvePaymentHistoryDetailHref({
        sourceKind: 'event_ticket_sale',
        sourceId: 'sale-1',
        category: 'EVENTOS',
        eventId: 'event-1',
      }),
    ).toBe('/events/event-1');

    expect(
      resolvePaymentHistoryDetailHref({
        sourceKind: 'cobranca',
        sourceId: 'cobranca-1',
        category: 'MENSALIDADE',
      }),
    ).toBe('/cobrancas/cobranca-1');
  });
});
