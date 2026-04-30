import { describe, it, expect } from 'vitest';
import { colaboradorSchema } from '../../../../packages/lib/src/schemas/colaborador';

const base = {
  nome: 'Maria Colaboradora',
  cpf: '529.982.247-25',
  cargo: 'RECEPCAO' as const,
  status: 'ATIVO' as const,
  email: 'maria@example.com',
  dataNasc: new Date('1990-01-01'),
  telefone1: '(11) 98765-4321',
  enderecoCep: '12345-678',
};

describe('colaboradorSchema', () => {
  it('valida caso feliz', () => {
    const r = colaboradorSchema.safeParse(base);
    expect(r.success).toBe(true);
  });
  it('rejeita cpf inválido', () => {
    const r = colaboradorSchema.safeParse({ ...base, cpf: '000.000.000-00' });
    expect(r.success).toBe(false);
  });
  it('exige email quando temAcesso=true', () => {
    const r = colaboradorSchema.safeParse({ ...base, temAcesso: true, email: undefined });
    expect(r.success).toBe(false);
  });
});
