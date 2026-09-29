import { describe, it, expect } from 'vitest';
import {
  validarDataInicio,
  validarDiaVencimento,
  validarFormaPagamento,
  calcularValorFinal,
  validarDescontoFinanceiro,
  formatarValorMonetario,
  formatarData,
  gerarResumoDesconto,
  dadosFinanceirosSchema,
} from '@/lib/validations/financeiro.schema';

describe('Validações Financeiro', () => {
  describe('validarDataInicio', () => {
    it('rejeita data vazia', () => {
      const resultado = validarDataInicio(undefined);
      expect(resultado.valido).toBe(false);
      expect(resultado.tipo).toBe('error');
    });

    it('rejeita data inválida', () => {
      const resultado = validarDataInicio('data-invalida');
      expect(resultado.valido).toBe(false);
      expect(resultado.tipo).toBe('error');
    });

    it('rejeita data no passado', () => {
      const ontem = new Date();
      ontem.setDate(ontem.getDate() - 1);
      const dataStr = ontem.toISOString().slice(0, 10);

      const resultado = validarDataInicio(dataStr);
      expect(resultado.valido).toBe(false);
      expect(resultado.tipo).toBe('error');
      expect(resultado.mensagem).toContain('passado');
    });

    it('avisa quando data está muito distante (> 90 dias)', () => {
      const futuro = new Date();
      futuro.setDate(futuro.getDate() + 100);
      const dataStr = futuro.toISOString().slice(0, 10);

      const resultado = validarDataInicio(dataStr);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('warning');
      expect(resultado.mensagem).toContain('distante');
    });

    it('aceita data próxima (próximos 30 dias)', () => {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const dataStr = amanha.toISOString().slice(0, 10);

      const resultado = validarDataInicio(dataStr);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('success');
    });
  });

  describe('validarDiaVencimento', () => {
    it('rejeita dia undefined', () => {
      const resultado = validarDiaVencimento(undefined);
      expect(resultado.valido).toBe(false);
    });

    it('rejeita dia decimal', () => {
      const resultado = validarDiaVencimento(15.5);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('inteiro');
    });

    it('rejeita dia < 1', () => {
      const resultado = validarDiaVencimento(0);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('entre 1 e 28');
    });

    it('rejeita dia > 28', () => {
      const resultado = validarDiaVencimento(29);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('entre 1 e 28');
    });

    it('aceita dia recomendado (5, 10, 15, 20, 25)', () => {
      const resultado = validarDiaVencimento(10);
      expect(resultado.valido).toBe(true);
      expect(resultado.mensagem).toContain('recomendado');
    });

    it('aceita dia não recomendado mas válido', () => {
      const resultado = validarDiaVencimento(7);
      expect(resultado.valido).toBe(true);
      expect(resultado.mensagem).toContain('configurado');
    });
  });

  describe('validarFormaPagamento', () => {
    it('rejeita forma undefined', () => {
      const resultado = validarFormaPagamento(undefined);
      expect(resultado.valido).toBe(false);
    });

    it('rejeita forma inválida', () => {
      const resultado = validarFormaPagamento('CHEQUE');
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagem).toContain('inválida');
    });

    it('aceita DINHEIRO', () => {
      const resultado = validarFormaPagamento('DINHEIRO');
      expect(resultado.valido).toBe(true);
    });

    it('aceita PIX', () => {
      const resultado = validarFormaPagamento('PIX');
      expect(resultado.valido).toBe(true);
    });

    it('aceita CARTAO', () => {
      const resultado = validarFormaPagamento('CARTAO');
      expect(resultado.valido).toBe(true);
    });

    it('aceita BOLETO', () => {
      const resultado = validarFormaPagamento('BOLETO');
      expect(resultado.valido).toBe(true);
    });
  });

  describe('calcularValorFinal', () => {
    it('retorna valor base sem desconto', () => {
      expect(calcularValorFinal(100, undefined, undefined)).toBe(100);
    });

    it('aplica desconto fixo', () => {
      expect(calcularValorFinal(100, 'FIXO', 20)).toBe(80);
    });

    it('aplica desconto percentual', () => {
      expect(calcularValorFinal(100, 'PERCENTUAL', 10)).toBe(90);
    });

    it('não permite valor negativo', () => {
      expect(calcularValorFinal(100, 'FIXO', 150)).toBe(0);
    });

    it('limita desconto percentual a 100%', () => {
      expect(calcularValorFinal(100, 'PERCENTUAL', 150)).toBe(0);
    });

    it('ignora desconto zero', () => {
      expect(calcularValorFinal(100, 'FIXO', 0)).toBe(100);
    });
  });

  describe('validarDescontoFinanceiro', () => {
    it('aceita sem desconto', () => {
      const resultado = validarDescontoFinanceiro(100, undefined, undefined);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('success');
    });

    it('rejeita desconto negativo', () => {
      const resultado = validarDescontoFinanceiro(100, 'FIXO', -10);
      expect(resultado.valido).toBe(false);
      expect(resultado.tipo).toBe('error');
    });

    it('rejeita desconto fixo maior que valor base', () => {
      const resultado = validarDescontoFinanceiro(100, 'FIXO', 150);
      expect(resultado.valido).toBe(false);
      expect(resultado.tipo).toBe('error');
    });

    it('rejeita desconto percentual > 100%', () => {
      const resultado = validarDescontoFinanceiro(100, 'PERCENTUAL', 150);
      expect(resultado.valido).toBe(false);
      expect(resultado.tipo).toBe('error');
    });

    it('avisa desconto fixo alto (> 50% do valor)', () => {
      const resultado = validarDescontoFinanceiro(100, 'FIXO', 60);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('warning');
      expect(resultado.mensagem).toContain('alto');
    });

    it('avisa desconto percentual alto (> 50%)', () => {
      const resultado = validarDescontoFinanceiro(100, 'PERCENTUAL', 60);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('warning');
      expect(resultado.mensagem).toContain('alto');
    });

    it('aceita desconto fixo válido', () => {
      const resultado = validarDescontoFinanceiro(100, 'FIXO', 20);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('success');
    });

    it('aceita desconto percentual válido', () => {
      const resultado = validarDescontoFinanceiro(100, 'PERCENTUAL', 10);
      expect(resultado.valido).toBe(true);
      expect(resultado.tipo).toBe('success');
    });
  });

  describe('formatarValorMonetario', () => {
    it('formata valor corretamente', () => {
      expect(formatarValorMonetario(150)).toContain('150,00');
      expect(formatarValorMonetario(150)).toContain('R$');
    });

    it('retorna R$ 0,00 para undefined', () => {
      const resultado = formatarValorMonetario(undefined);
      expect(resultado).toContain('0,00');
      expect(resultado).toContain('R$');
    });

    it('retorna R$ 0,00 para NaN', () => {
      const resultado = formatarValorMonetario(NaN);
      expect(resultado).toContain('0,00');
      expect(resultado).toContain('R$');
    });
  });

  describe('formatarData', () => {
    it('formata data corretamente', () => {
      const resultado = formatarData('2025-10-15');
      expect(resultado).toContain('outubro');
      expect(resultado).toContain('2025');
    });

    it('retorna — para undefined', () => {
      expect(formatarData(undefined)).toBe('—');
    });

    it('retorna — para data inválida', () => {
      expect(formatarData('data-invalida')).toBe('—');
    });
  });

  describe('gerarResumoDesconto', () => {
    it('retorna sem desconto quando não há desconto', () => {
      const resumo = gerarResumoDesconto(100, undefined, undefined);
      expect(resumo.temDesconto).toBe(false);
      expect(resumo.valorFinal).toBe(100);
      expect(resumo.valorDesconto).toBe(0);
    });

    it('calcula desconto fixo corretamente', () => {
      const resumo = gerarResumoDesconto(100, 'FIXO', 20);
      expect(resumo.temDesconto).toBe(true);
      expect(resumo.valorFinal).toBe(80);
      expect(resumo.valorDesconto).toBe(20);
      expect(resumo.textoDesconto).toContain('fixo');
    });

    it('calcula desconto percentual corretamente', () => {
      const resumo = gerarResumoDesconto(100, 'PERCENTUAL', 10);
      expect(resumo.temDesconto).toBe(true);
      expect(resumo.valorFinal).toBe(90);
      expect(resumo.valorDesconto).toBe(10);
      expect(resumo.textoDesconto).toContain('10%');
    });
  });

  describe('dadosFinanceirosSchema', () => {
    it('valida dados completos', () => {
      const dados = {
        dataInicio: '2025-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX' as const,
        planoValor: 150,
      };
      expect(() => dadosFinanceirosSchema.parse(dados)).not.toThrow();
    });

    it('rejeita data inválida', () => {
      const dados = {
        dataInicio: 'data-invalida',
        vencimentoDia: 10,
        formaPagamento: 'PIX' as const,
        planoValor: 150,
      };
      expect(() => dadosFinanceirosSchema.parse(dados)).toThrow();
    });

    it('rejeita dia fora do range', () => {
      const dados = {
        dataInicio: '2025-10-15',
        vencimentoDia: 30,
        formaPagamento: 'PIX' as const,
        planoValor: 150,
      };
      expect(() => dadosFinanceirosSchema.parse(dados)).toThrow();
    });

    it('rejeita forma de pagamento inválida', () => {
      const dados = {
        dataInicio: '2025-10-15',
        vencimentoDia: 10,
        formaPagamento: 'CHEQUE',
        planoValor: 150,
      };
      expect(() => dadosFinanceirosSchema.parse(dados)).toThrow();
    });
  });
});
