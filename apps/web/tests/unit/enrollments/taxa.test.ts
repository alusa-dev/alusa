import { describe, it, expect } from 'vitest';
import {
  validarTaxaMatricula,
  formatarTaxa,
  validarJustificativaIsencao,
  sugerirValorTaxa,
  taxaMatriculaSchema,
} from '@/lib/validations/taxa.schema';

describe('Validações Taxa de Matrícula', () => {
  describe('validarTaxaMatricula', () => {
    it('aceita taxa isenta com justificativa', () => {
      const resultado = validarTaxaMatricula(true, 0, 'Aluno bolsista integral');
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('success');
    });

    it('avisa quando taxa isenta sem justificativa', () => {
      const resultado = validarTaxaMatricula(true, 0, '');
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('warning');
      expect(resultado.mensagem).toContain('justificativa');
    });

    it('rejeita taxa não isenta com valor zero', () => {
      const resultado = validarTaxaMatricula(false, 0, undefined);
      expect(resultado.valido).toBe(false);
      expect(resultado.tipo).toBe('error');
    });

    it('rejeita taxa não isenta sem valor', () => {
      const resultado = validarTaxaMatricula(false, undefined, undefined);
      expect(resultado.valido).toBe(false);
      expect(resultado.tipo).toBe('error');
    });

    it('avisa quando valor abaixo do usual (< 50)', () => {
      const resultado = validarTaxaMatricula(false, 30, undefined);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('warning');
      expect(resultado.mensagem).toContain('abaixo');
    });

    it('avisa quando valor acima do usual (> 500)', () => {
      const resultado = validarTaxaMatricula(false, 600, undefined);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('warning');
      expect(resultado.mensagem).toContain('acima');
    });

    it('aceita valor dentro da faixa normal', () => {
      const resultado = validarTaxaMatricula(false, 120, undefined);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('success');
    });
  });

  describe('formatarTaxa', () => {
    it('formata valor corretamente', () => {
      expect(formatarTaxa(120)).toContain('120,00');
      expect(formatarTaxa(120)).toContain('R$');
    });

    it('retorna R$ 0,00 para undefined', () => {
      const resultado = formatarTaxa(undefined);
      expect(resultado).toContain('0,00');
      expect(resultado).toContain('R$');
    });

    it('retorna R$ 0,00 para NaN', () => {
      const resultado = formatarTaxa(NaN);
      expect(resultado).toContain('0,00');
      expect(resultado).toContain('R$');
    });

    it('formata valores decimais', () => {
      expect(formatarTaxa(150.5)).toContain('150,50');
      expect(formatarTaxa(150.5)).toContain('R$');
    });
  });

  describe('validarJustificativaIsencao', () => {
    it('rejeita justificativa vazia', () => {
      const resultado = validarJustificativaIsencao('');
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('Recomenda-se');
    });

    it('rejeita justificativa muito curta', () => {
      const resultado = validarJustificativaIsencao('Curta');
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('muito curta');
    });

    it('rejeita justificativa muito longa', () => {
      const texto = 'A'.repeat(501);
      const resultado = validarJustificativaIsencao(texto);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('muito longa');
    });

    it('aceita justificativa adequada', () => {
      const resultado = validarJustificativaIsencao('Aluno bolsista integral do programa social');
      expect(resultado.valido).toBe(true);
      expect(resultado.mensagem).toContain('adequada');
    });
  });

  describe('sugerirValorTaxa', () => {
    it('retorna 120 quando plano não definido', () => {
      expect(sugerirValorTaxa(undefined)).toBe(120);
    });

    it('retorna 120 quando plano é zero', () => {
      expect(sugerirValorTaxa(0)).toBe(120);
    });

    it('calcula 80% do valor do plano', () => {
      expect(sugerirValorTaxa(150)).toBe(120); // 80% de 150 = 120
    });

    it('limita sugestão ao mínimo de 50', () => {
      expect(sugerirValorTaxa(30)).toBe(50); // 80% de 30 = 24, mas limita a 50
    });

    it('limita sugestão ao máximo de 300', () => {
      expect(sugerirValorTaxa(500)).toBe(300); // 80% de 500 = 400, mas limita a 300
    });
  });

  describe('taxaMatriculaSchema', () => {
    it('valida taxa isenta', () => {
      const dados = {
        taxaIsenta: true,
        taxaMatricula: 0,
        taxaJustificativa: 'Bolsista',
      };
      expect(() => taxaMatriculaSchema.parse(dados)).not.toThrow();
    });

    it('valida taxa cobrada com valor válido', () => {
      const dados = {
        taxaIsenta: false,
        taxaMatricula: 120,
      };
      expect(() => taxaMatriculaSchema.parse(dados)).not.toThrow();
    });

    it('rejeita taxa não isenta com valor zero', () => {
      const dados = {
        taxaIsenta: false,
        taxaMatricula: 0,
      };
      expect(() => taxaMatriculaSchema.parse(dados)).toThrow();
    });

    it('rejeita valor negativo', () => {
      const dados = {
        taxaIsenta: false,
        taxaMatricula: -50,
      };
      expect(() => taxaMatriculaSchema.parse(dados)).toThrow();
    });
  });
});
