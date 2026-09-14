import { describe, expect, it } from 'vitest';

import { toCheckInCode } from './ticket-code';

describe('toCheckInCode', () => {
  it('usa os últimos oito dígitos quando o código possui números suficientes', () => {
    expect(toCheckInCode('ticket_123456789')).toBe('23456789');
  });

  it('gera um código estável de oito dígitos para códigos sem números suficientes', () => {
    const first = toCheckInCode('TICKET_ABCD');
    const second = toCheckInCode('TICKET_ABCD');

    expect(first).toHaveLength(8);
    expect(first).toBe(second);
    expect(first).toMatch(/^\d{8}$/);
  });
});
