import { describe, expect, it } from 'vitest';
import { isValidCpf, maskCpf, parseCpf } from './cpf.js';

describe('CPF value object', () => {
  it('normaliza e aceita CPF válido', () => {
    expect(parseCpf('529.982.247-25')).toEqual({ ok: true, value: '52998224725' });
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('rejeita CPF com dígitos repetidos', () => {
    expect(parseCpf('111.111.111-11')).toEqual({
      ok: false,
      error: 'CPF com dígitos repetidos é inválido.',
    });
  });

  it('rejeita dígitos verificadores inválidos', () => {
    expect(isValidCpf('52998224724')).toBe(false);
  });

  it('mascara CPF normalizado', () => {
    expect(maskCpf('52998224725')).toBe('529.982.247-25');
  });
});
