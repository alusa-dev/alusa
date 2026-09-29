import { describe, it, expect } from 'vitest';
import {
  validarPlanoDisponivel,
  formatarValorPlano,
  calcularValorComDesconto,
  validarDesconto,
  planoSelecaoSchema,
} from '@/lib/validations/plano.schema';

describe('Validações Plano', () => {
  describe('validarPlanoDisponivel', () => {
    it('rejeita quando nenhum plano está selecionado', () => {
      const resultado = validarPlanoDisponivel(undefined, []);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('Nenhum plano selecionado');
    });

    it('rejeita quando plano não é encontrado', () => {
      const planos = [{ id: 'plano-1', ativo: true }];
      const resultado = validarPlanoDisponivel('plano-inexistente', planos);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('não encontrado');
    });

    it('rejeita plano inativo', () => {
      const planos = [{ id: 'plano-1', ativo: false }];
      const resultado = validarPlanoDisponivel('plano-1', planos);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('inativo');
    });

    it('aceita plano ativo encontrado', () => {
      const planos = [{ id: 'plano-1', ativo: true }];
      const resultado = validarPlanoDisponivel('plano-1', planos);
      expect(resultado.valido).toBe(true);
      expect(resultado.mensagem).toContain('válido');
    });

    it('aceita plano quando ativo não está definido (padrão ativo)', () => {
      const planos = [{ id: 'plano-1' }];
      const resultado = validarPlanoDisponivel('plano-1', planos);
      expect(resultado.valido).toBe(true);
    });
  });

  describe('formatarValorPlano', () => {
    it('formata valor monetário corretamente', () => {
      expect(formatarValorPlano(150)).toBe('R$\xa0150,00');
    });

    it('formata valores decimais', () => {
      expect(formatarValorPlano(99.99)).toBe('R$\xa099,99');
    });

    it('retorna mensagem para undefined', () => {
      expect(formatarValorPlano(undefined)).toBe('Valor não definido');
    });

    it('retorna mensagem para NaN', () => {
      expect(formatarValorPlano(NaN)).toBe('Valor não definido');
    });
  });

  describe('calcularValorComDesconto', () => {
    it('retorna valor base sem desconto', () => {
      expect(calcularValorComDesconto(100, undefined, undefined)).toBe(100);
    });

    it('aplica desconto fixo corretamente', () => {
      expect(calcularValorComDesconto(100, 'FIXO', 20)).toBe(80);
    });

    it('aplica desconto percentual corretamente', () => {
      expect(calcularValorComDesconto(100, 'PERCENTUAL', 10)).toBe(90);
    });

    it('não permite valor negativo com desconto fixo muito alto', () => {
      expect(calcularValorComDesconto(100, 'FIXO', 150)).toBe(0);
    });

    it('limita desconto percentual a 100%', () => {
      expect(calcularValorComDesconto(100, 'PERCENTUAL', 150)).toBe(0);
    });

    it('ignora desconto com valor zero', () => {
      expect(calcularValorComDesconto(100, 'FIXO', 0)).toBe(100);
      expect(calcularValorComDesconto(100, 'PERCENTUAL', 0)).toBe(100);
    });

    it('ignora desconto negativo', () => {
      expect(calcularValorComDesconto(100, 'FIXO', -10)).toBe(100);
      expect(calcularValorComDesconto(100, 'PERCENTUAL', -10)).toBe(100);
    });
  });

  describe('validarDesconto', () => {
    it('aceita ausência de desconto', () => {
      const resultado = validarDesconto(100, undefined, undefined);
      expect(resultado.valido).toBe(true);
      expect(resultado.mensagem).toContain('Sem desconto');
    });

    it('rejeita desconto fixo maior que valor base', () => {
      const resultado = validarDesconto(100, 'FIXO', 150);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('maior que o valor do plano');
    });

    it('rejeita desconto percentual maior que 100%', () => {
      const resultado = validarDesconto(100, 'PERCENTUAL', 150);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('maior que 100%');
    });

    it('rejeita desconto com valor negativo', () => {
      const resultado = validarDesconto(100, 'FIXO', -10);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('deve ser positivo');
    });

    it('aceita desconto com valor zero (sem desconto)', () => {
      const resultado = validarDesconto(100, 'FIXO', 0);
      expect(resultado.valido).toBe(true);
      expect(resultado.mensagem).toContain('Sem desconto');
    });

    it('aceita desconto fixo válido', () => {
      const resultado = validarDesconto(100, 'FIXO', 20);
      expect(resultado.valido).toBe(true);
      expect(resultado.mensagem).toContain('válido');
    });

    it('aceita desconto percentual válido', () => {
      const resultado = validarDesconto(100, 'PERCENTUAL', 10);
      expect(resultado.valido).toBe(true);
      expect(resultado.mensagem).toContain('válido');
    });

    it('aceita desconto percentual de 100%', () => {
      const resultado = validarDesconto(100, 'PERCENTUAL', 100);
      expect(resultado.valido).toBe(true);
    });
  });

  describe('planoSelecaoSchema', () => {
    it('valida seleção de plano válida', () => {
      const dados = {
        planoId: 'plano-123',
        planoLabel: 'Plano Mensal',
        planoValor: 150,
      };
      expect(() => planoSelecaoSchema.parse(dados)).not.toThrow();
    });

    it('rejeita planoId vazio', () => {
      const dados = {
        planoId: '',
        planoLabel: 'Plano Mensal',
        planoValor: 150,
      };
      expect(() => planoSelecaoSchema.parse(dados)).toThrow();
    });

    it('rejeita valor negativo', () => {
      const dados = {
        planoId: 'plano-123',
        planoValor: -50,
      };
      expect(() => planoSelecaoSchema.parse(dados)).toThrow();
    });

    it('aceita sem planoLabel e planoValor (opcionais)', () => {
      const dados = {
        planoId: 'plano-123',
      };
      expect(() => planoSelecaoSchema.parse(dados)).not.toThrow();
    });
  });
});
