import { StatusMatricula } from '@prisma/client';
import {
  doesMatriculaOccupySeat,
  getSeatOccupyingStatuses,
  buildSeatOccupancyWhereClause,
  calcularVagasDisponiveis,
  SEAT_OCCUPYING_STATUSES,
  NON_SEAT_OCCUPYING_STATUSES,
} from './matricula-occupancy';

describe('matricula-occupancy', () => {
  describe('SEAT_OCCUPYING_STATUSES', () => {
    it('inclui PENDENTE_TAXA', () => {
      expect(SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.PENDENTE_TAXA);
    });

    it('inclui AGUARDANDO_CONFIRMACAO', () => {
      expect(SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.AGUARDANDO_CONFIRMACAO);
    });

    it('inclui ATIVA', () => {
      expect(SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.ATIVA);
    });

    it('não inclui PAUSADA', () => {
      expect(SEAT_OCCUPYING_STATUSES).not.toContain(StatusMatricula.PAUSADA);
    });

    it('não inclui RECUSADA', () => {
      expect(SEAT_OCCUPYING_STATUSES).not.toContain(StatusMatricula.RECUSADA);
    });

    it('não inclui CANCELADA', () => {
      expect(SEAT_OCCUPYING_STATUSES).not.toContain(StatusMatricula.CANCELADA);
    });
  });

  describe('NON_SEAT_OCCUPYING_STATUSES', () => {
    it('inclui PAUSADA', () => {
      expect(NON_SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.PAUSADA);
    });

    it('inclui RECUSADA', () => {
      expect(NON_SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.RECUSADA);
    });

    it('inclui CANCELADA', () => {
      expect(NON_SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.CANCELADA);
    });
  });

  describe('doesMatriculaOccupySeat', () => {
    describe('status que ocupam vaga', () => {
      it('PENDENTE_TAXA → true', () => {
        expect(doesMatriculaOccupySeat(StatusMatricula.PENDENTE_TAXA)).toBe(true);
      });

      it('AGUARDANDO_CONFIRMACAO → true', () => {
        expect(doesMatriculaOccupySeat(StatusMatricula.AGUARDANDO_CONFIRMACAO)).toBe(true);
      });

      it('ATIVA → true', () => {
        expect(doesMatriculaOccupySeat(StatusMatricula.ATIVA)).toBe(true);
      });
    });

    describe('status que NÃO ocupam vaga', () => {
      it('PAUSADA → false', () => {
        expect(doesMatriculaOccupySeat(StatusMatricula.PAUSADA)).toBe(false);
      });

      it('RECUSADA → false', () => {
        expect(doesMatriculaOccupySeat(StatusMatricula.RECUSADA)).toBe(false);
      });

      it('CANCELADA → false', () => {
        expect(doesMatriculaOccupySeat(StatusMatricula.CANCELADA)).toBe(false);
      });
    });

    describe('aceita string', () => {
      it('string "ATIVA" → true', () => {
        expect(doesMatriculaOccupySeat('ATIVA')).toBe(true);
      });

      it('string "CANCELADA" → false', () => {
        expect(doesMatriculaOccupySeat('CANCELADA')).toBe(false);
      });
    });
  });

  describe('getSeatOccupyingStatuses', () => {
    it('retorna array com 3 status', () => {
      const statuses = getSeatOccupyingStatuses();
      expect(statuses).toHaveLength(3);
    });

    it('retorna cópia (não é mesma referência)', () => {
      const a = getSeatOccupyingStatuses();
      const b = getSeatOccupyingStatuses();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it('contém todos os status de ocupação', () => {
      const statuses = getSeatOccupyingStatuses();
      expect(statuses).toContain(StatusMatricula.PENDENTE_TAXA);
      expect(statuses).toContain(StatusMatricula.AGUARDANDO_CONFIRMACAO);
      expect(statuses).toContain(StatusMatricula.ATIVA);
    });
  });

  describe('buildSeatOccupancyWhereClause', () => {
    it('inclui status base que ocupam vaga', () => {
      const where = buildSeatOccupancyWhereClause();
      expect(where.OR[0]).toEqual({
        status: {
          in: [
            StatusMatricula.PENDENTE_TAXA,
            StatusMatricula.AGUARDANDO_CONFIRMACAO,
            StatusMatricula.ATIVA,
          ],
        },
      });
    });

    it('inclui exceção de pausa com retenção de vaga', () => {
      const where = buildSeatOccupancyWhereClause();
      expect(where.OR[1]).toEqual({
        status: StatusMatricula.PAUSADA,
        manterVaga: true,
      });
    });
  });

  describe('calcularVagasDisponiveis', () => {
    describe('turma com vagas', () => {
      it('capacidade 30, ocupadas 20 → 10 disponíveis, sem alerta', () => {
        const resultado = calcularVagasDisponiveis(30, 20);
        expect(resultado).toEqual({
          disponiveis: 10,
          temVaga: true,
          alerta: false,
        });
      });

      it('capacidade 30, ocupadas 28 → 2 disponíveis, com alerta', () => {
        const resultado = calcularVagasDisponiveis(30, 28);
        expect(resultado).toEqual({
          disponiveis: 2,
          temVaga: true,
          alerta: true,
          mensagem: '⚠️ Apenas 2 vaga(s) restante(s)',
        });
      });

      it('capacidade 30, ocupadas 29 → 1 disponível, com alerta', () => {
        const resultado = calcularVagasDisponiveis(30, 29);
        expect(resultado).toEqual({
          disponiveis: 1,
          temVaga: true,
          alerta: true,
          mensagem: '⚠️ Apenas 1 vaga(s) restante(s)',
        });
      });
    });

    describe('turma sem vagas', () => {
      it('capacidade 30, ocupadas 30 → 0 disponíveis', () => {
        const resultado = calcularVagasDisponiveis(30, 30);
        expect(resultado).toEqual({
          disponiveis: 0,
          temVaga: false,
          alerta: true,
          mensagem: 'Turma sem vagas disponíveis',
        });
      });

      it('capacidade 30, ocupadas 35 → 0 disponíveis (não fica negativo)', () => {
        const resultado = calcularVagasDisponiveis(30, 35);
        expect(resultado).toEqual({
          disponiveis: 0,
          temVaga: false,
          alerta: true,
          mensagem: 'Turma sem vagas disponíveis',
        });
      });
    });

    describe('turma vazia', () => {
      it('capacidade 30, ocupadas 0 → 30 disponíveis', () => {
        const resultado = calcularVagasDisponiveis(30, 0);
        expect(resultado).toEqual({
          disponiveis: 30,
          temVaga: true,
          alerta: false,
        });
      });
    });
  });
});
