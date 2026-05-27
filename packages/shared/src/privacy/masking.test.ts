import { describe, expect, it } from 'vitest';

import { maskCnpj, maskCpf, maskEmail, maskPhone, maskPixKey } from './masking';

describe('privacy masking', () => {
  it('mascara documentos e contatos pessoais', () => {
    expect(maskCpf('123.456.789-00')).toBe('123.***.***-00');
    expect(maskCnpj('12.345.678/0001-90')).toBe('12.***.***/****-90');
    expect(maskEmail('responsavel@example.com')).toBe('re*********@example.com');
    expect(maskPhone('(11) 99999-1234')).toBe('11*****1234');
  });

  it('mascara chave Pix conforme formato', () => {
    expect(maskPixKey('aluno@example.com')).toBe('al***@example.com');
    expect(maskPixKey('12345678900')).toBe('123.***.***-00');
  });
});
