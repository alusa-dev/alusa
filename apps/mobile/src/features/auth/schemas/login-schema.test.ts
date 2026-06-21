import { loginSchema } from './login-schema';

describe('loginSchema', () => {
  it('valida submit correto', () => {
    expect(loginSchema.safeParse({ email: 'admin@alusa.test', password: '123456' }).success).toBe(true);
  });

  it('rejeita e-mail inválido', () => {
    expect(loginSchema.safeParse({ email: 'admin', password: '123456' }).success).toBe(false);
  });

  it('exige senha', () => {
    expect(loginSchema.safeParse({ email: 'admin@alusa.test', password: '' }).success).toBe(false);
  });
});
