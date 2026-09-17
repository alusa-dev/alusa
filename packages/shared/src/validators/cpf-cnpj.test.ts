import { describe, expect, it } from 'vitest';

import {
  isValidCnpjDigits,
  isValidCpfCnpjDigits,
  isValidCpfDigits,
  maskCpfCnpj,
} from './cpf-cnpj';

describe('CPF/CNPJ shared validators', () => {
  it('valida documentos brasileiros e rejeita sequências repetidas', () => {
    expect(isValidCpfDigits('529.982.247-25')).toBe(true);
    expect(isValidCnpjDigits('11.222.333/0001-81')).toBe(true);
    expect(isValidCpfCnpjDigits('111.111.111-11')).toBe(false);
  });

  it('formata CPF e CNPJ sem depender de infraestrutura', () => {
    expect(maskCpfCnpj('52998224725')).toBe('529.982.247-25');
    expect(maskCpfCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
});
