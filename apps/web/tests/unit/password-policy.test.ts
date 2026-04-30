import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const passwordMinLength = Number(process.env.PASSWORD_MIN_LENGTH || 8);
const passwordMessage = 'Senha deve ter no mínimo 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';
const passwordRegex = new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{' + String(passwordMinLength) + ',}$');
const schema = z.object({ senha: z.string().regex(passwordRegex, passwordMessage) });

function validate(pwd: string) {
  const r = schema.safeParse({ senha: pwd });
  return r.success ? 'ok' : r.error.issues[0].message;
}

describe('Política de Senha', () => {
  it('aceita senha válida', () => {
    expect(validate('Teste@123')).toBe('ok');
  });
  it('rejeita curta', () => {
    expect(validate('Aa1@aaa')).toBe(passwordMessage);
  });
  it('rejeita sem maiúscula', () => {
    expect(validate('teste@123')).toBe(passwordMessage);
  });
  it('rejeita sem minúscula', () => {
    expect(validate('TESTE@123')).toBe(passwordMessage);
  });
  it('rejeita sem número', () => {
    expect(validate('Teste@ABC')).toBe(passwordMessage);
  });
  it('rejeita sem especial', () => {
    expect(validate('Teste1234')).toBe(passwordMessage);
  });
});
