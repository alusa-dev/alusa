import { describe, expect, it } from 'vitest';
import { planoFormSchema } from '@alusa/lib';

describe('planoFormSchema', () => {
  it('normaliza e valida um plano válido', () => {
    const result = planoFormSchema.safeParse({
      nome: '  Plano Mensal  ',
      descricao: '  Aula duas vezes por semana  ',
      periodicidade: 'MENSAL',
      valor: '199.90',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nome).toBe('Plano Mensal');
    expect(result.data.descricao).toBe('Aula duas vezes por semana');
    expect(result.data.periodicidade).toBe('MENSAL');
    expect(result.data.valor).toBe(199.9);
  });

  it('aceita valores com vírgula e remove milhares', () => {
    const result = planoFormSchema.safeParse({
      nome: 'Plano Trimestral',
      descricao: null,
      periodicidade: 'TRIMESTRAL',
      valor: '1.234,56',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.valor).toBeCloseTo(1234.56, 2);
    expect(result.data.descricao).toBeNull();
  });

  it('valida plano semanal', () => {
    const result = planoFormSchema.safeParse({
      nome: 'Plano Semanal',
      descricao: 'Treinos toda semana',
      periodicidade: 'SEMANAL',
      valor: '59,90',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.periodicidade).toBe('SEMANAL');
    expect(result.data.valor).toBeCloseTo(59.9, 2);
  });

  it('valida plano quinzenal', () => {
    const result = planoFormSchema.safeParse({
      nome: 'Plano Quinzenal',
      descricao: 'Treinos a cada quinze dias',
      periodicidade: 'QUINZENAL',
      valor: '109.00',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.periodicidade).toBe('QUINZENAL');
  });

  it('falha quando o nome é muito curto', () => {
    const result = planoFormSchema.safeParse({
      nome: 'A',
      descricao: '',
      periodicidade: 'ANUAL',
      valor: '249.90',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.nome).toBeDefined();
  });

  it('falha quando o valor é negativo', () => {
    const result = planoFormSchema.safeParse({
      nome: 'Plano Básico',
      descricao: 'teste',
      periodicidade: 'MENSAL',
      valor: '-10',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.valor).toBeDefined();
  });
});
