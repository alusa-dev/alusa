import { describe, it, expect } from 'vitest';
import {
  validarFaixaEtaria,
  validarCapacidadeTurma,
  formatarHorario,
  formatarDiasSemana,
  turmaPlanoSchema,
} from '@/lib/validations/turma-plano.schema';

describe('Validações Turma/Plano', () => {
  describe('validarFaixaEtaria', () => {
    it('aceita aluno dentro da faixa etária', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 10; // 10 anos
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = validarFaixaEtaria(dataNasc!, 8, 12);

      expect(result.valido).toBe(true);
      expect(result.mensagem).toBeUndefined();
    });

    it('rejeita aluno abaixo da idade mínima', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 5; // 5 anos
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = validarFaixaEtaria(dataNasc!, 8, 12);

      expect(result.valido).toBe(false);
      expect(result.mensagem).toContain('5 anos');
      expect(result.mensagem).toContain('Idade mínima: 8');
    });

    it('rejeita aluno acima da idade máxima', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 15; // 15 anos
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = validarFaixaEtaria(dataNasc!, 8, 12);

      expect(result.valido).toBe(false);
      expect(result.mensagem).toContain('15 anos');
      expect(result.mensagem).toContain('Idade máxima: 12');
    });

    it('aceita aluno quando não há limites definidos', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 10;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = validarFaixaEtaria(dataNasc!);

      expect(result.valido).toBe(true);
    });
  });

  describe('validarCapacidadeTurma', () => {
    it('aceita turma com vagas disponíveis', () => {
      const result = validarCapacidadeTurma(20, 15);

      expect(result.valido).toBe(true);
      expect(result.mensagem).toBeUndefined();
    });

    it('rejeita turma sem vagas', () => {
      const result = validarCapacidadeTurma(20, 20);

      expect(result.valido).toBe(false);
      expect(result.mensagem).toBe('Turma sem vagas disponíveis');
    });

    it('avisa quando há poucas vagas (2 ou menos)', () => {
      const result = validarCapacidadeTurma(20, 18);

      expect(result.valido).toBe(true);
      expect(result.mensagem).toContain('2 vaga(s) restante(s)');
    });

    it('avisa quando há apenas 1 vaga', () => {
      const result = validarCapacidadeTurma(20, 19);

      expect(result.valido).toBe(true);
      expect(result.mensagem).toContain('1 vaga(s) restante(s)');
    });
  });

  describe('formatarHorario', () => {
    it('formata horário sem minutos', () => {
      expect(formatarHorario('08:00')).toBe('8h');
      expect(formatarHorario('14:00')).toBe('14h');
    });

    it('formata horário com minutos', () => {
      expect(formatarHorario('08:30')).toBe('8h30');
      expect(formatarHorario('14:45')).toBe('14h45');
    });

    it('retorna -- para horário inválido', () => {
      expect(formatarHorario()).toBe('--');
      expect(formatarHorario('')).toBe('--');
      expect(formatarHorario('invalid')).toBe('--');
    });
  });

  describe('formatarDiasSemana', () => {
    it('formata um dia', () => {
      expect(formatarDiasSemana(['SEG'])).toBe('Seg');
    });

    it('formata múltiplos dias', () => {
      expect(formatarDiasSemana(['SEG', 'QUA', 'SEX'])).toBe('Seg, Qua, Sex');
    });

    it('formata todos os dias', () => {
      expect(formatarDiasSemana(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'])).toBe(
        'Seg, Ter, Qua, Qui, Sex, Sáb, Dom',
      );
    });

    it('retorna string vazia para array vazio', () => {
      expect(formatarDiasSemana([])).toBe('');
    });
  });

  describe('turmaPlanoSchema', () => {
    it('aceita turma selecionada com plano', () => {
      const result = turmaPlanoSchema.safeParse({
        modoTurmas: 'TURMAS',
        turmaId: 'turma-123',
        planoId: 'plano-456',
      });

      expect(result.success).toBe(true);
    });

    it('aceita combo selecionado com plano', () => {
      const result = turmaPlanoSchema.safeParse({
        modoTurmas: 'COMBO',
        comboId: 'combo-123',
        planoId: 'plano-456',
      });

      expect(result.success).toBe(true);
    });

    it('rejeita modo TURMAS sem turmaId', () => {
      const result = turmaPlanoSchema.safeParse({
        modoTurmas: 'TURMAS',
        planoId: 'plano-456',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('turma ou combo');
      }
    });

    it('rejeita modo COMBO sem comboId', () => {
      const result = turmaPlanoSchema.safeParse({
        modoTurmas: 'COMBO',
        planoId: 'plano-456',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('turma ou combo');
      }
    });

    it('rejeita seleção sem plano', () => {
      const result = turmaPlanoSchema.safeParse({
        modoTurmas: 'TURMAS',
        turmaId: 'turma-123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message === 'Plano obrigatório')).toBe(true);
      }
    });
  });
});
