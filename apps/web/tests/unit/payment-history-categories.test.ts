import { describe, expect, it } from 'vitest';

import {
  normalizePaymentHistoryCategory,
  PAYMENT_HISTORY_CATEGORY_LABELS,
  resolvePaymentHistoryDetailHref,
} from '@/features/financeiro/pagamentos/payment-history-categories';

describe('payment-history-categories', () => {
  it('normaliza tipos academicos e standalone para categorias canonicas', () => {
    expect(normalizePaymentHistoryCategory({ tipo: 'TAXA_MATRICULA' })).toBe('TAXA_MATRICULA');
    expect(normalizePaymentHistoryCategory({ tipo: 'MENSALIDADE' })).toBe('MENSALIDADE');
    expect(normalizePaymentHistoryCategory({ tipo: 'PARCELADA' })).toBe('PARCELAMENTO');
    expect(normalizePaymentHistoryCategory({ chargeType: 'INSTALLMENT' })).toBe('PARCELAMENTO');
    expect(normalizePaymentHistoryCategory({ tipo: 'RECORRENTE' })).toBe('ASSINATURA');
    expect(normalizePaymentHistoryCategory({ chargeType: 'SUBSCRIPTION' })).toBe('ASSINATURA');
    expect(normalizePaymentHistoryCategory({ tipo: 'LOJA', origin: 'LOJA' })).toBe('LOJA');
    expect(normalizePaymentHistoryCategory({ sourceKind: 'sale', tipo: 'LOJA' })).toBe('LOJA');
    expect(normalizePaymentHistoryCategory({ tipo: 'AVULSA' })).toBe('OUTROS');
  });

  it('expoe labels amigaveis para as cinco secoes principais', () => {
    expect(PAYMENT_HISTORY_CATEGORY_LABELS.MENSALIDADE).toBe('Mensalidades');
    expect(PAYMENT_HISTORY_CATEGORY_LABELS.PARCELAMENTO).toBe('Parcelamentos');
    expect(PAYMENT_HISTORY_CATEGORY_LABELS.ASSINATURA).toBe('Assinaturas');
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
        sourceKind: 'cobranca',
        sourceId: 'cb-1',
        category: 'MENSALIDADE',
      }),
    ).toBe('/cobrancas/cb-1');
  });
});
