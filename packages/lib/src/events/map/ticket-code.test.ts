import { describe, expect, it } from 'vitest';

import {
  createCheckInCode,
  formatCheckInCode,
  normalizeCheckInCode,
  toCheckInCode,
} from './ticket-code';

describe('createCheckInCode', () => {
  it('gera códigos compactos Crockford Base32 com 12 caracteres', () => {
    const code = createCheckInCode();

    expect(code).toHaveLength(12);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it('formata e normaliza o código sem alterar o valor usado para busca', () => {
    expect(formatCheckInCode('01AB23CD45EF')).toBe('01AB-23CD-45EF');
    expect(normalizeCheckInCode(' 01ab-23cd-45ef ')).toBe('01AB23CD45EF');
  });

  it('gera códigos distintos em amostra consecutiva', () => {
    const codes = new Set(Array.from({ length: 500 }, () => createCheckInCode()));
    expect(codes.size).toBe(500);
  });
});

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
