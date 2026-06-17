import { describe, expect, it } from 'vitest';

import {
  formatNbsCode,
  isValidNbsCodeFormat,
  normalizeNbsCodeForAsaas,
} from '../nbs-code';

describe('nbs-code', () => {
  it('formata 9 dígitos no padrão Asaas N.NNNN.NN.NN', () => {
    expect(formatNbsCode('122011100')).toBe('1.2201.11.00');
    expect(formatNbsCode('101011100')).toBe('1.0101.11.00');
  });

  it('normaliza entrada sem o primeiro segmento (12201.11.00 → 1.2201.11.00)', () => {
    expect(normalizeNbsCodeForAsaas('12201.11.00')).toBe('1.2201.11.00');
  });

  it('aceita código já normalizado', () => {
    expect(normalizeNbsCodeForAsaas('1.2201.11.00')).toBe('1.2201.11.00');
    expect(isValidNbsCodeFormat('1.2201.11.00')).toBe(true);
  });

  it('rejeita códigos incompletos', () => {
    expect(normalizeNbsCodeForAsaas('1.22')).toBeUndefined();
    expect(isValidNbsCodeFormat('12201.11.00')).toBe(false);
  });
});
