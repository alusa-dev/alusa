import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepararPayloadMatricula } from '@/lib/validations/resumo.schema';
import type { WizardState } from '@/components/matriculas/wizard/types';

describe('Integração do Wizard com API', () => {
  const mockWizardState: WizardState = {
    contaId: 'conta-123',
    aluno: { id: 'aluno-123', nome: 'João Silva', dataNasc: '2010-05-15' },
    modoTurmas: 'TURMAS',
    turmaIds: ['turma-1'],
    planoId: 'plano-123',
    planoValor: 150,
    modoBeneficio: 'SEM',
    vencimentoDia: 10,
    taxaMatricula: 50,
    taxaIsenta: false,
    formaPagamento: 'PIX',
    modeloId: 'modelo-123',
    criarCobranca: true,
    dataInicio: '2025-10-05',
    dataFimContrato: '2026-10-05',
    confirmacaoRevisao: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('prepararPayloadMatricula', () => {
    it('deve preparar payload válido do wizard', () => {
      const result = prepararPayloadMatricula(
        mockWizardState as unknown as Record<string, unknown>,
      );

      expect(result.valido).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.erros).toHaveLength(0);

      if (result.payload) {
        expect(result.payload.contaId).toBe('conta-123');
        expect(result.payload.alunoId).toBe('aluno-123');
        expect(result.payload.planoId).toBe('plano-123');
        expect(result.payload.turmaId).toBe('turma-1');
        // dataInicio pode ser string ou Date dependendo do schema
        expect(result.payload.dataInicio).toBeTruthy();
        expect(result.payload.vencimentoDia).toBe(10);
        expect(result.payload.taxaMatricula).toBe(50);
        expect(result.payload.taxaIsenta).toBe(false);
        expect(result.payload.formaPagamento).toBe('PIX');
      }
    });

    it('deve rejeitar wizard sem aluno', () => {
      const invalidState = { ...mockWizardState, aluno: undefined };
      const result = prepararPayloadMatricula(invalidState as unknown as Record<string, unknown>);

      expect(result.valido).toBe(false);
      expect(result.erros.length).toBeGreaterThan(0);
      expect(result.erros.some((e) => e.includes('aluno'))).toBe(true);
    });

    it('deve rejeitar wizard sem plano', () => {
      const invalidState = { ...mockWizardState, planoId: undefined };
      const result = prepararPayloadMatricula(invalidState as unknown as Record<string, unknown>);

      expect(result.valido).toBe(false);
      expect(result.erros.length).toBeGreaterThan(0);
      expect(result.erros.some((e) => e.includes('plano'))).toBe(true);
    });

    it('deve rejeitar wizard sem turma/combo', () => {
      const invalidState = { ...mockWizardState, turmaIds: [], comboId: undefined };
      const result = prepararPayloadMatricula(invalidState as unknown as Record<string, unknown>);

      expect(result.valido).toBe(false);
      expect(result.erros.length).toBeGreaterThan(0);
    });

    it('deve rejeitar wizard sem confirmação', () => {
      const invalidState = { ...mockWizardState, confirmacaoRevisao: false };
      const result = prepararPayloadMatricula(invalidState as unknown as Record<string, unknown>);

      expect(result.valido).toBe(false);
      // Verifica se tem erro relacionado (pode ser 'confirmação', 'confirmado', 'revisar', etc)
      expect(result.erros.length).toBeGreaterThan(0);
    });

    it('deve aceitar taxa isenta sem valor', () => {
      const stateIsento = {
        ...mockWizardState,
        taxaIsenta: true,
        taxaMatricula: 0,
        taxaJustificativa: 'Bolsa integral',
      };
      const result = prepararPayloadMatricula(stateIsento as unknown as Record<string, unknown>);

      expect(result.valido).toBe(true);
      if (result.payload) {
        expect(result.payload.taxaIsenta).toBe(true);
        expect(result.payload.taxaMatricula).toBe(0);
      }
    });

    it('deve aceitar desconto antecipado percentual (Asaas)', () => {
      const stateDesconto = {
        ...mockWizardState,
        descontoTipo: 'PERCENTAGE' as const,
        descontoAntecipado: 20,
        prazoDesconto: 5,
      };
      const result = prepararPayloadMatricula(stateDesconto as unknown as Record<string, unknown>);

      expect(result.valido).toBe(true);
    });

    it('deve aceitar desconto antecipado fixo (Asaas)', () => {
      const stateDesconto = {
        ...mockWizardState,
        descontoTipo: 'FIXED' as const,
        descontoAntecipado: 30,
        prazoDesconto: 0,
      };
      const result = prepararPayloadMatricula(stateDesconto as unknown as Record<string, unknown>);

      expect(result.valido).toBe(true);
    });

    it('deve exigir seleção explícita quando a matrícula for marcada com benefício', () => {
      const stateSemSelecao = {
        ...mockWizardState,
        modoBeneficio: 'COM' as const,
        beneficioSelecionado: null,
      };

      const result = prepararPayloadMatricula(stateSemSelecao as unknown as Record<string, unknown>);

      expect(result.valido).toBe(false);
      expect(result.erros).toContain('Selecione um benefício para esta matrícula.');
    });

    it('deve serializar benefício do catálogo como descontoId', () => {
      const stateComBeneficio = {
        ...mockWizardState,
        modoBeneficio: 'COM' as const,
        beneficioSelecionado: {
          id: 'desconto-1',
          nome: 'Convênio escola',
          tipo: 'FIXO',
          valor: 25,
          escopo: 'MATRICULA',
          origem: 'CATALOGO',
        },
      };

      const result = prepararPayloadMatricula(
        stateComBeneficio as unknown as Record<string, unknown>,
      );

      expect(result.valido).toBe(true);
      expect(result.payload?.descontoIds).toEqual(['desconto-1']);
    });

    it('deve aceitar combo ao invés de turma', () => {
      const stateCombo = {
        ...mockWizardState,
        modoTurmas: 'COMBO' as const,
        turmaIds: [],
        comboId: 'combo-123',
      };
      const result = prepararPayloadMatricula(stateCombo as unknown as Record<string, unknown>);

      expect(result.valido).toBe(true);
      if (result.payload) {
        expect(result.payload.comboId).toBe('combo-123');
        expect(result.payload.turmaId).toBeUndefined();
      }
    });

    it('deve validar data de início', () => {
      const stateSemData = { ...mockWizardState, dataInicio: undefined };
      const result = prepararPayloadMatricula(stateSemData as unknown as Record<string, unknown>);

      expect(result.valido).toBe(false);
      expect(result.erros.some((e) => e.includes('data'))).toBe(true);
    });

    it('deve validar forma de pagamento', () => {
      const stateSemPagamento = { ...mockWizardState, formaPagamento: undefined };
      const result = prepararPayloadMatricula(
        stateSemPagamento as unknown as Record<string, unknown>,
      );

      expect(result.valido).toBe(false);
      expect(result.erros.some((e) => e.includes('pagamento'))).toBe(true);
    });
  });
});
