import { describe, expect, it } from 'vitest';

import {
  mapPaymentRulesToCobrancaFields,
  paymentRulesFromParticipantSnapshot,
} from '../payment-rules';

describe('cobranca payment rules mapper', () => {
  it('maps the participant snapshot used by event charges', () => {
    const rules = paymentRulesFromParticipantSnapshot({
      interestPercent: 2,
      fine: { type: 'FIXED', value: 10 },
      discount: { type: 'PERCENTAGE', value: 5, dueDateLimitDays: 3 },
    });

    expect(rules).toEqual({
      interestValue: 2,
      fineValue: 10,
      fineType: 'FIXED',
      discountValue: 5,
      discountType: 'PERCENTAGE',
      discountDueDateLimitDays: 3,
    });
    expect(mapPaymentRulesToCobrancaFields(rules)).toMatchObject({
      multaTipo: 'VALOR_FIXO',
      multaValorFixo: 10,
      descontoTipo: 'PERCENTUAL',
      descontoPercentual: 5,
      descontoPrazoMaximo: '3_DIAS',
    });
  });
});
