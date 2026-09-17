import { describe, expect, it } from 'vitest';

import {
  buildCobrancaAsaasPaymentUpdatePayload,
  normalizeCobrancaPaymentAdjustmentType,
  resolveCanonicalDiscountDueDateLimit,
} from './cobranca-payment-update-payload';

describe('cobranca payment update payload', () => {
  it('normaliza aliases legados dos ajustes', () => {
    expect(normalizeCobrancaPaymentAdjustmentType('fixo')).toBe('VALOR_FIXO');
    expect(normalizeCobrancaPaymentAdjustmentType('PERCENTAGE')).toBe('PERCENTUAL');
    expect(normalizeCobrancaPaymentAdjustmentType(null)).toBeUndefined();
  });

  it('remove prazo residual quando o desconto é zerado', () => {
    expect(
      resolveCanonicalDiscountDueDateLimit({
        descontoPrazoMaximo: '9_DIAS',
        normalizedDescontoTipo: 'PERCENTUAL',
        descontoPercentual: 0,
      }),
    ).toBe('ATE_VENCIMENTO');
  });

  it('constrói o payload Asaas usando o snapshot para campos não alterados', () => {
    const payload = buildCobrancaAsaasPaymentUpdatePayload({
      currentPayment: {
        billingType: 'BOLETO',
        value: 100,
        dueDate: '2026-01-05',
      },
      changes: {
        valor: 125,
        vencimento: '2026-01-10T12:00:00.000Z',
        jurosPercentual: 1.5,
        multaPercentual: 2,
        normalizedMultaTipo: 'PERCENTUAL',
        descontoPercentual: 5,
        normalizedDescontoTipo: 'PERCENTUAL',
        descontoPrazoMaximo: '3_DIAS',
      },
    });

    expect(payload).toEqual({
      billingType: 'BOLETO',
      value: 125,
      dueDate: '2026-01-10',
      interest: { value: 1.5 },
      fine: { value: 2, type: 'PERCENTAGE' },
      discount: { value: 5, type: 'PERCENTAGE', dueDateLimitDays: 3 },
    });
  });
});
