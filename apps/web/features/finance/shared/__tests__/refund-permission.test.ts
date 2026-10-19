import { describe, expect, it } from 'vitest';

import { canRequestFinancialRefund } from '../refund-permission';

describe('canRequestFinancialRefund', () => {
  it.each(['ADMIN', 'FINANCEIRO', ' admin ', 'financeiro'])('allows %s', (role) => {
    expect(canRequestFinancialRefund(role)).toBe(true);
  });

  it.each([null, undefined, 'SECRETARIA', 'OPERADOR', 'PROFESSOR'])('denies %s', (role) => {
    expect(canRequestFinancialRefund(role)).toBe(false);
  });
});
