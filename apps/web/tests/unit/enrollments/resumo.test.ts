import { describe, it, expect } from 'vitest';
import {
  validarMatriculaCompleta,
  calcularIdadeAluno,
  gerarResumoFinanceiro,
  formatarFormaPagamento,
  descreverModoTurmas,
  gerarWarningsRevisao,
  prepararPayloadMatricula,
  resumoMatriculaSchema,
} from '@/lib/validations/resumo.schema';

describe('Validações Resumo', () => {
  describe('validarMatriculaCompleta', () => {
    it('rejeita quando falta aluno', () => {
      const state = {
        planoId: 'plano-1',
        taxaMatricula: 120,
        dataInicio: '2025-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX',
        confirmacaoRevisao: true,
      };

      const resultado = validarMatriculaCompleta(state);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagens).toContain('Selecione um aluno');
    });

    it('rejeita quando falta turma/combo', () => {
      const state = {
        aluno: { id: 'aluno-1', nome: 'João' },
        modoTurmas: 'TURMAS',
        turmaIds: [],
        planoId: 'plano-1',
        taxaMatricula: 120,
        dataInicio: '2025-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX',
        confirmacaoRevisao: true,
      };

      const resultado = validarMatriculaCompleta(state);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagens).toContain('Selecione pelo menos uma turma');
    });

    it('rejeita quando falta plano', () => {
      const state = {
        aluno: { id: 'aluno-1', nome: 'João' },
        modoTurmas: 'TURMAS',
        turmaIds: ['turma-1'],
        taxaMatricula: 120,
        dataInicio: '2025-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX',
        confirmacaoRevisao: true,
      };

      const resultado = validarMatriculaCompleta(state);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagens).toContain('Selecione um plano');
    });

    it('rejeita quando taxa não isenta sem valor', () => {
      const state = {
        aluno: { id: 'aluno-1', nome: 'João' },
        modoTurmas: 'TURMAS',
        turmaIds: ['turma-1'],
        planoId: 'plano-1',
        taxaIsenta: false,
        taxaMatricula: 0,
        dataInicio: '2025-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX',
        confirmacaoRevisao: true,
      };

      const resultado = validarMatriculaCompleta(state);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagens.some((m) => m.includes('taxa'))).toBe(true);
    });

    it('rejeita quando falta confirmação', () => {
      const state = {
        aluno: { id: 'aluno-1', nome: 'João' },
        modoTurmas: 'TURMAS',
        turmaIds: ['turma-1'],
        planoId: 'plano-1',
        taxaIsenta: true,
        dataInicio: '2025-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX',
        confirmacaoRevisao: false,
      };

      const resultado = validarMatriculaCompleta(state);
      expect(resultado.valido).toBe(false);
      expect(resultado.mensagens).toContain('Você deve revisar e confirmar os dados');
    });

    it('aceita dados completos válidos', () => {
      const state = {
        aluno: { id: 'aluno-1', nome: 'João' },
        modoTurmas: 'TURMAS',
        turmaIds: ['turma-1'],
        planoId: 'plano-1',
        taxaIsenta: true,
        taxaMatricula: 0,
        dataInicio: '2025-10-15',
        dataFimContrato: '2026-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX',
        modeloId: 'modelo-1',
        confirmacaoRevisao: true,
      };

      const resultado = validarMatriculaCompleta(state);
      expect(resultado.valido).toBe(true);
      expect(resultado.camposFaltando).toHaveLength(0);
    });
  });

  describe('calcularIdadeAluno', () => {
    it('retorna null para data vazia', () => {
      expect(calcularIdadeAluno(undefined)).toBeNull();
    });

    it('retorna null para data inválida', () => {
      expect(calcularIdadeAluno('data-invalida')).toBeNull();
    });

    it('calcula idade corretamente', () => {
      // Aniversário há 10 anos exatos
      const dataHa10Anos = new Date();
      dataHa10Anos.setFullYear(dataHa10Anos.getFullYear() - 10);
      const dataStr = dataHa10Anos.toISOString().slice(0, 10);

      expect(calcularIdadeAluno(dataStr)).toBe(10);
    });

    it('não faz aniversário ainda este ano', () => {
      const hoje = new Date();
      const dataNasc = new Date(hoje.getFullYear() - 10, hoje.getMonth() + 1, hoje.getDate());
      const dataStr = dataNasc.toISOString().slice(0, 10);

      const idade = calcularIdadeAluno(dataStr);
      expect(idade).toBe(9); // Ainda não fez aniversário
    });
  });

  describe('gerarResumoFinanceiro', () => {
    it('calcula valores corretamente', () => {
      const resumo = gerarResumoFinanceiro({
        planoValor: 150,
        taxaMatricula: 120,
        taxaIsenta: false,
      });

      expect(resumo.valorPlano).toBe(150);
      expect(resumo.valorTaxa).toBe(120);
      expect(resumo.totalInicial).toBe(270);
    });

    it('considera taxa isenta', () => {
      const resumo = gerarResumoFinanceiro({
        planoValor: 150,
        taxaMatricula: 120,
        taxaIsenta: true,
      });

      expect(resumo.valorTaxa).toBe(0);
      expect(resumo.totalInicial).toBe(150);
    });

    it('considera benefício aplicado à mensalidade', () => {
      const resumo = gerarResumoFinanceiro({
        planoValor: 150,
        taxaMatricula: 120,
        taxaIsenta: false,
        beneficioSelecionado: {
          tipo: 'PERCENTUAL',
          valor: 50,
        },
      });

      expect(resumo.valorBeneficio).toBe(75);
      expect(resumo.valorPlanoLiquido).toBe(75);
      expect(resumo.totalInicial).toBe(195);
    });
  });

  describe('formatarFormaPagamento', () => {
    it('formata DINHEIRO', () => {
      expect(formatarFormaPagamento('DINHEIRO')).toBe('Dinheiro');
    });

    it('formata PIX', () => {
      expect(formatarFormaPagamento('PIX')).toBe('PIX');
    });

    it('formata CARTAO', () => {
      expect(formatarFormaPagamento('CARTAO')).toBe('Cartão de Crédito');
    });

    it('formata BOLETO', () => {
      expect(formatarFormaPagamento('BOLETO')).toBe('Boleto Bancário');
    });

    it('retorna — para undefined', () => {
      expect(formatarFormaPagamento(undefined)).toBe('—');
    });
  });

  describe('descreverModoTurmas', () => {
    it('descreve COMBO com label', () => {
      const state = {
        modoTurmas: 'COMBO' as const,
        comboLabel: 'Combo Premium',
        comboId: 'combo-1',
      };
      expect(descreverModoTurmas(state)).toBe('Combo Premium');
    });

    it('descreve COMBO sem label', () => {
      const state = {
        modoTurmas: 'COMBO' as const,
        comboId: 'combo-1',
      };
      expect(descreverModoTurmas(state)).toBe('Combo combo-1');
    });

    it('descreve uma turma com label', () => {
      const state = {
        modoTurmas: 'TURMAS' as const,
        turmaIds: ['turma-1'],
        turmaLabel: 'Turma Iniciante',
      };
      expect(descreverModoTurmas(state)).toBe('Turma Iniciante');
    });

    it('descreve múltiplas turmas', () => {
      const state = {
        modoTurmas: 'TURMAS' as const,
        turmaIds: ['turma-1', 'turma-2', 'turma-3'],
      };
      expect(descreverModoTurmas(state)).toBe('3 turmas selecionadas');
    });
  });

  describe('gerarWarningsRevisao', () => {
    it('avisa taxa isenta sem justificativa', () => {
      const warnings = gerarWarningsRevisao({
        taxaIsenta: true,
        taxaJustificativa: '',
      });

      expect(warnings).toContain('⚠️ Taxa isenta sem justificativa detalhada');
    });

    it('avisa desconto alto', () => {
      const warnings = gerarWarningsRevisao({
        planoValor: 100,
        descontoTipo: 'PERCENTAGE',
        descontoAntecipado: 40,
      });

      expect(warnings.some((w) => w.includes('Desconto'))).toBe(true);
    });

    it('avisa data muito distante', () => {
      const futuro = new Date();
      futuro.setDate(futuro.getDate() + 70);
      const dataStr = futuro.toISOString().slice(0, 10);

      const warnings = gerarWarningsRevisao({
        dataInicio: dataStr,
      });

      expect(warnings.some((w) => w.includes('dias no futuro'))).toBe(true);
    });

    it('retorna array vazio quando não há warnings', () => {
      const warnings = gerarWarningsRevisao({
        taxaIsenta: true,
        taxaJustificativa: 'Aluno bolsista integral',
        planoValor: 100,
        descontoAntecipado: 10,
        descontoTipo: 'PERCENTAGE',
        dataInicio: new Date().toISOString().slice(0, 10),
      });

      expect(warnings).toHaveLength(0);
    });
  });

  describe('prepararPayloadMatricula', () => {
    it('retorna erros quando dados incompletos', () => {
      const state = {
        planoId: 'plano-1',
      };

      const resultado = prepararPayloadMatricula(state);
      expect(resultado.valido).toBe(false);
      expect(resultado.erros.length).toBeGreaterThan(0);
      expect(resultado.payload).toBeUndefined();
    });

    it('gera payload válido quando dados completos', () => {
      const state = {
        aluno: {
          id: 'aluno-1',
          nome: 'João',
          responsavel: { id: 'resp-1', nome: 'Maria' },
        },
        modoTurmas: 'TURMAS',
        turmaIds: ['turma-1'],
        planoId: 'plano-1',
        taxaIsenta: true,
        taxaMatricula: 0,
        dataInicio: '2025-10-15',
        dataFimContrato: '2026-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX',
        modeloId: 'modelo-1',
        confirmacaoRevisao: true,
        contaId: 'conta-1',
      };

      const resultado = prepararPayloadMatricula(state);
      expect(resultado.valido).toBe(true);
      expect(resultado.payload).toBeDefined();
      expect(resultado.payload?.alunoId).toBe('aluno-1');
      expect(resultado.payload?.responsavelFinanceiroId).toBe('resp-1');
      expect(resultado.payload?.turmaId).toBe('turma-1');
      expect(resultado.payload?.planoId).toBe('plano-1');
      expect(resultado.payload?.modeloId).toBe('modelo-1');
    });
  });

  describe('resumoMatriculaSchema', () => {
    it('valida matrícula completa', () => {
      const dados = {
        aluno: {
          id: 'aluno-1',
          nome: 'João Silva',
          dataNasc: '2015-05-10',
          responsavel: {
            id: 'resp-1',
            nome: 'Maria Silva',
          },
        },
        modoTurmas: 'TURMAS' as const,
        turmaIds: ['turma-1'],
        planoId: 'plano-1',
        planoValor: 150,
        taxaIsenta: false,
        taxaMatricula: 120,
        dataInicio: '2025-10-15',
        dataFimContrato: '2026-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX' as const,
        modeloId: 'modelo-1',
        confirmacaoRevisao: true,
      };

      expect(() => resumoMatriculaSchema.parse(dados)).not.toThrow();
    });

    it('rejeita sem aluno', () => {
      const dados = {
        modoTurmas: 'TURMAS' as const,
        turmaIds: ['turma-1'],
        planoId: 'plano-1',
        planoValor: 150,
        taxaIsenta: true,
        taxaMatricula: 0,
        dataInicio: '2025-10-15',
        dataFimContrato: '2026-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX' as const,
        confirmacaoRevisao: true,
      };

      expect(() => resumoMatriculaSchema.parse(dados)).toThrow();
    });

    it('rejeita modo TURMAS sem turmas', () => {
      const dados = {
        aluno: { id: 'aluno-1', nome: 'João' },
        modoTurmas: 'TURMAS' as const,
        turmaIds: [],
        planoId: 'plano-1',
        planoValor: 150,
        taxaIsenta: true,
        taxaMatricula: 0,
        dataInicio: '2025-10-15',
        dataFimContrato: '2026-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX' as const,
        confirmacaoRevisao: true,
      };

      expect(() => resumoMatriculaSchema.parse(dados)).toThrow();
    });

    it('rejeita sem confirmação', () => {
      const dados = {
        aluno: { id: 'aluno-1', nome: 'João' },
        modoTurmas: 'TURMAS' as const,
        turmaIds: ['turma-1'],
        planoId: 'plano-1',
        planoValor: 150,
        taxaIsenta: true,
        taxaMatricula: 0,
        dataInicio: '2025-10-15',
        dataFimContrato: '2026-10-15',
        vencimentoDia: 10,
        formaPagamento: 'PIX' as const,
        confirmacaoRevisao: false,
      };

      expect(() => resumoMatriculaSchema.parse(dados)).toThrow();
    });
  });
});
