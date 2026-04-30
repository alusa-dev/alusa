import { describe, it, expect } from 'vitest';
import { ProfessorCreateSchema } from '@alusa/lib';

const base = {
  contaId: 'ckv0n1xq9000001l5c3z9f9a1',
  nome: 'Professor Teste',
  cpf: '390.533.447-05',
  dataNasc: new Date('1990-01-01'),
  email: 'prof@ex.com',
  telefoneCel: '(11) 99999-9999',
  especialidades: [],
  status: 'ATIVO' as const,
};

describe('ProfessorCreateSchema', () => {
  it('valida caso feliz', () => {
    const r = ProfessorCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
  });
  it('rejeita cpf inválido', () => {
    const r = ProfessorCreateSchema.safeParse({ ...base, cpf: '000.000.000-00' });
    expect(r.success).toBe(false);
  });
  it('rejeita menor de 18 anos', () => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 10);
    const r = ProfessorCreateSchema.safeParse({ ...base, dataNasc: d });
    expect(r.success).toBe(false);
  });
  it('rejeita email inválido', () => {
    const r = ProfessorCreateSchema.safeParse({ ...base, email: 'x' });
    expect(r.success).toBe(false);
  });
});
