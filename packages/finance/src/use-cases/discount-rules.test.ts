import { describe, expect, it } from 'vitest';

import { parseDiscountDueDateLimitDays } from './discount-rules';

describe('parseDiscountDueDateLimitDays', () => {
  it.each([
    ['ATE_VENCIMENTO', 0],
    ['1_DIA', 1],
    ['3_DIAS', 3],
    ['7_DIAS', 7],
    ['15_DIAS', 15],
    ['30_DIAS', 30],
  ])('converte %s para %s dias', (value, expected) => {
    expect(parseDiscountDueDateLimitDays(value)).toBe(expected);
  });

  it('usa zero para valor ausente ou inválido', () => {
    expect(parseDiscountDueDateLimitDays()).toBe(0);
    expect(parseDiscountDueDateLimitDays('INVALIDO')).toBe(0);
  });
});
