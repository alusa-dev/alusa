import { describe, it, expect } from 'vitest';
import {
  calcularIdade,
  isMenorDeIdade,
  resolvePayer,
  type ResolvePayerResult,
} from './matricula-rules';

describe('calcularIdade', () => {
  it('deve calcular idade corretamente para pessoa de ~25 anos', () => {
    const hoje = new Date();
    // Aniversário já passou este ano (1 mês atrás)
    const dataNasc = new Date(hoje.getFullYear() - 25, hoje.getMonth() - 1, hoje.getDate());
    expect(calcularIdade(dataNasc)).toBeGreaterThanOrEqual(24);
    expect(calcularIdade(dataNasc)).toBeLessThanOrEqual(25);
  });

  it('deve calcular idade corretamente para pessoa de ~17 anos', () => {
    const hoje = new Date();
    const dataNasc = new Date(hoje.getFullYear() - 17, hoje.getMonth() - 1, hoje.getDate());
    expect(calcularIdade(dataNasc)).toBeGreaterThanOrEqual(16);
    expect(calcularIdade(dataNasc)).toBeLessThanOrEqual(17);
  });

  it('deve retornar idade menor quando aniversário ainda não chegou', () => {
    const hoje = new Date();
    // Aniversário ainda não chegou este ano
    const dataNasc = new Date(hoje.getFullYear() - 18, hoje.getMonth() + 1, hoje.getDate());
    expect(calcularIdade(dataNasc)).toBeLessThan(18);
  });
});

describe('isMenorDeIdade', () => {
  it('deve retornar true para menor de 18', () => {
    const hoje = new Date();
    const dataNasc = new Date(hoje.getFullYear() - 17, hoje.getMonth(), hoje.getDate());
    expect(isMenorDeIdade(dataNasc)).toBe(true);
  });

  it('deve retornar false para exatamente 18 anos', () => {
    const hoje = new Date();
    const dataNasc = new Date(hoje.getFullYear() - 18, hoje.getMonth(), hoje.getDate());
    expect(isMenorDeIdade(dataNasc)).toBe(false);
  });

  it('deve retornar false para maior de 18', () => {
    const hoje = new Date();
    const dataNasc = new Date(hoje.getFullYear() - 30, hoje.getMonth(), hoje.getDate());
    expect(isMenorDeIdade(dataNasc)).toBe(false);
  });
});

describe('resolvePayer', () => {
  const alunoId = 'aluno-123';
  const responsavelId = 'responsavel-456';

  // Helper para criar data de nascimento com idade específica
  function dataNascParaIdade(idade: number): Date {
    const hoje = new Date();
    return new Date(hoje.getFullYear() - idade, hoje.getMonth(), hoje.getDate());
  }

  describe('aluno maior de idade (>= 18)', () => {
    it('deve retornar o próprio aluno como pagador quando >= 18', () => {
      const result = resolvePayer({
        alunoId,
        alunoDataNasc: dataNascParaIdade(25),
        responsavelFinanceiroId: null,
      });

      expect(result).toEqual<ResolvePayerResult>({
        success: true,
        payer: { type: 'ALUNO', id: alunoId },
      });
    });

    it('deve retornar responsável financeiro se presente, mesmo para maior de idade', () => {
      const result = resolvePayer({
        alunoId,
        alunoDataNasc: dataNascParaIdade(18),
        responsavelFinanceiroId: responsavelId,
      });

      // NOVO COMPORTAMENTO: Se tem responsável, usa o responsável.
      expect(result).toEqual<ResolvePayerResult>({
        success: true,
        payer: { type: 'RESPONSAVEL', id: responsavelId },
      });
    });

    it('deve funcionar para aluno exatamente com 18 anos', () => {
      const result = resolvePayer({
        alunoId,
        alunoDataNasc: dataNascParaIdade(18),
        responsavelFinanceiroId: undefined,
      });

      expect(result).toEqual<ResolvePayerResult>({
        success: true,
        payer: { type: 'ALUNO', id: alunoId },
      });
    });
  });

  describe('aluno menor de idade (< 18)', () => {
    it('deve retornar responsável como pagador quando menor e responsável presente', () => {
      const result = resolvePayer({
        alunoId,
        alunoDataNasc: dataNascParaIdade(15),
        responsavelFinanceiroId: responsavelId,
      });

      expect(result).toEqual<ResolvePayerResult>({
        success: true,
        payer: { type: 'RESPONSAVEL', id: responsavelId },
      });
    });

    it('deve falhar quando menor de idade sem responsável', () => {
      const result = resolvePayer({
        alunoId,
        alunoDataNasc: dataNascParaIdade(10),
        responsavelFinanceiroId: null,
      });

      expect(result).toEqual<ResolvePayerResult>({
        success: false,
        error: 'RESPONSAVEL_OBRIGATORIO_MENOR',
      });
    });

    it('deve falhar quando menor com responsável undefined', () => {
      const result = resolvePayer({
        alunoId,
        alunoDataNasc: dataNascParaIdade(17),
        responsavelFinanceiroId: undefined,
      });

      expect(result).toEqual<ResolvePayerResult>({
        success: false,
        error: 'RESPONSAVEL_OBRIGATORIO_MENOR',
      });
    });

    it('deve funcionar para aluno com 17 anos e 364 dias', () => {
      // Quase 18 mas ainda menor
      const hoje = new Date();
      const dataNasc = new Date(
        hoje.getFullYear() - 18,
        hoje.getMonth(),
        hoje.getDate() + 1
      );

      const result = resolvePayer({
        alunoId,
        alunoDataNasc: dataNasc,
        responsavelFinanceiroId: responsavelId,
      });

      expect(result).toEqual<ResolvePayerResult>({
        success: true,
        payer: { type: 'RESPONSAVEL', id: responsavelId },
      });
    });
  });

  describe('edge cases', () => {
    it('deve falhar se alunoId vazio e maior de idade', () => {
      const result = resolvePayer({
        alunoId: '',
        alunoDataNasc: dataNascParaIdade(20),
        responsavelFinanceiroId: null,
      });

      expect(result).toEqual<ResolvePayerResult>({
        success: false,
        error: 'ALUNO_SEM_ID',
      });
    });
  });
});
