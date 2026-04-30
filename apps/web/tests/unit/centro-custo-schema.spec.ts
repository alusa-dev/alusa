import { describe, it, expect } from 'vitest';
import { centroCustoCreateSchema } from '@/app/api/financeiro/centros-custo/route';

describe('centroCustoCreateSchema', () => {
  it('aceita nome, tipo e status padrão ATIVO', () => {
    const result = centroCustoCreateSchema.parse({
      nome: 'Financeiro Geral',
      tipo: 'MISTO',
    });
    expect(result.status).toBe('ATIVO');
  });

  it('rejeita nome curto', () => {
    expect(() =>
      centroCustoCreateSchema.parse({
        nome: 'A',
        tipo: 'RECEITA',
      }),
    ).toThrow();
  });

  it('aceita descrição opcional e status INATIVO', () => {
    const result = centroCustoCreateSchema.parse({
      nome: 'Marketing',
      tipo: 'DESPESA',
      descricao: 'Centro para campanhas',
      status: 'INATIVO',
    });
    expect(result.status).toBe('INATIVO');
    expect(result.descricao).toBe('Centro para campanhas');
  });
});
