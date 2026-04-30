import { describe, expect, it } from 'vitest';
import {
  calcularValorDescontoBeneficio,
  calcularValorLiquidoComBeneficio,
  descreverBeneficioSelecionado,
} from '@/components/matriculas/wizard/beneficios';

describe('benefícios do wizard de matrícula', () => {
  it('calcula desconto percentual corretamente', () => {
    const desconto = calcularValorDescontoBeneficio(150, {
      id: 'b1',
      nome: 'Bolsa 50%',
      tipo: 'PERCENTUAL',
      valor: 50,
      escopo: 'MATRICULA',
      origem: 'CATALOGO',
    });

    expect(desconto).toBe(75);
    expect(
      calcularValorLiquidoComBeneficio(150, {
        id: 'b1',
        nome: 'Bolsa 50%',
        tipo: 'PERCENTUAL',
        valor: 50,
        escopo: 'MATRICULA',
        origem: 'CATALOGO',
      }),
    ).toBe(75);
  });

  it('calcula desconto fixo corretamente', () => {
    expect(
      calcularValorLiquidoComBeneficio(150, {
        id: 'd1',
        nome: 'Bolsa R$50',
        tipo: 'FIXO',
        valor: 50,
        escopo: 'MATRICULA',
        origem: 'CATALOGO',
      }),
    ).toBe(100);
  });

  it('não deixa o valor líquido negativo', () => {
    expect(
      calcularValorLiquidoComBeneficio(80, {
        id: 'd2',
        nome: 'Bolsa integral',
        tipo: 'FIXO',
        valor: 200,
        escopo: 'MATRICULA',
        origem: 'CATALOGO',
      }),
    ).toBe(0);
  });

  it('descreve o benefício selecionado', () => {
    expect(
      descreverBeneficioSelecionado({
        id: 'b1',
        nome: 'Bolsa do aluno',
        tipo: 'PERCENTUAL',
        valor: 30,
        escopo: 'MATRICULA',
        origem: 'CATALOGO',
      }),
    ).toBe('Bolsa do aluno (30%)');
  });
});
