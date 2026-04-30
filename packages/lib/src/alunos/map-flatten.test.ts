import { describe, it, expect } from 'vitest';
import { digits, nullifyEmpty, flattenAlunoEndereco, flattenResponsavelEndereco } from './map-flatten';

describe('map-flatten helpers', () => {
  it('digits should strip non-digits and return undefined for empty', () => {
    expect(digits('123.456-78')).toBe('12345678');
    expect(digits('(11) 98888-7777')).toBe('11988887777');
    expect(digits('abc')).toBeUndefined();
    expect(digits(undefined)).toBeUndefined();
    expect(digits(null)).toBeUndefined();
  });

  it('nullifyEmpty should trim and convert empty to null', () => {
    expect(nullifyEmpty('  ')).toBeNull();
    expect(nullifyEmpty(' test ')).toBe(' test ');
    expect(nullifyEmpty(undefined)).toBeUndefined();
    expect(nullifyEmpty(null)).toBeNull();
  });

  it('flattenAlunoEndereco should map and normalize fields', () => {
    const flat = flattenAlunoEndereco({ endereco: {
      cep: '12.345-678',
      logradouro: '  Rua X  ',
      numero: '  ',
      complemento: '',
      bairro: 'Centro',
      cidade: 'São Paulo',
      uf: 'sp'
    }});
    expect(flat.enderecoCep).toBe('12345678');
    expect(flat.enderecoLogradouro).toBe('  Rua X  ');
    expect(flat.enderecoNumero).toBeNull();
    expect(flat.enderecoComplemento).toBeNull();
    expect(flat.enderecoBairro).toBe('Centro');
    expect(flat.enderecoCidade).toBe('São Paulo');
    expect(flat.enderecoUf).toBe('SP');
  });

  it('flattenResponsavelEndereco should ignore missing endereco', () => {
    const flat = flattenResponsavelEndereco({});
    expect(flat).toEqual({});
  });
});
