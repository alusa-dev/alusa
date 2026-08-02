import { StatusMatricula } from '@prisma/client';
import {
  doesMatriculaOccupySeat,
  getSeatOccupyingStatuses,
  buildSeatOccupancyWhereClause,
  buildSeatOccupancyOverlapWhereClause,
  calcularVagasDisponiveis,
  SEAT_OCCUPYING_STATUSES,
  NON_SEAT_OCCUPYING_STATUSES,
} from './matricula-occupancy';

describe('matricula-occupancy', () => {
  describe('SEAT_OCCUPYING_STATUSES', () => {
    it('inclui apenas status que podem ocupar vaga quando vigentes', () => {
      expect(SEAT_OCCUPYING_STATUSES).toEqual([
        StatusMatricula.PENDENTE_TAXA,
        StatusMatricula.AGUARDANDO_CONFIRMACAO,
        StatusMatricula.ATIVA,
      ]);
      expect(SEAT_OCCUPYING_STATUSES).not.toContain(StatusMatricula.PAUSADA);
      expect(SEAT_OCCUPYING_STATUSES).not.toContain(StatusMatricula.RECUSADA);
      expect(SEAT_OCCUPYING_STATUSES).not.toContain(StatusMatricula.CANCELADA);
      expect(SEAT_OCCUPYING_STATUSES).not.toContain(StatusMatricula.ENCERRADA);
    });
  });

  describe('NON_SEAT_OCCUPYING_STATUSES', () => {
    it('inclui status que nao ocupam vaga por padrao', () => {
      expect(NON_SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.PAUSADA);
      expect(NON_SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.RECUSADA);
      expect(NON_SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.CANCELADA);
      expect(NON_SEAT_OCCUPYING_STATUSES).toContain(StatusMatricula.ENCERRADA);
    });
  });

  describe('doesMatriculaOccupySeat', () => {
    it('retorna true para status ocupantes', () => {
      expect(doesMatriculaOccupySeat(StatusMatricula.PENDENTE_TAXA)).toBe(true);
      expect(doesMatriculaOccupySeat(StatusMatricula.AGUARDANDO_CONFIRMACAO)).toBe(true);
      expect(doesMatriculaOccupySeat(StatusMatricula.ATIVA)).toBe(true);
      expect(doesMatriculaOccupySeat('ATIVA')).toBe(true);
    });

    it('retorna false para status nao ocupantes', () => {
      expect(doesMatriculaOccupySeat(StatusMatricula.PAUSADA)).toBe(false);
      expect(doesMatriculaOccupySeat(StatusMatricula.RECUSADA)).toBe(false);
      expect(doesMatriculaOccupySeat(StatusMatricula.CANCELADA)).toBe(false);
      expect(doesMatriculaOccupySeat(StatusMatricula.ENCERRADA)).toBe(false);
      expect(doesMatriculaOccupySeat('CANCELADA')).toBe(false);
    });
  });

  describe('getSeatOccupyingStatuses', () => {
    it('retorna copia com os status de ocupacao', () => {
      const a = getSeatOccupyingStatuses();
      const b = getSeatOccupyingStatuses();

      expect(a).toHaveLength(3);
      expect(a).not.toBe(b);
      expect(a).toEqual([
        StatusMatricula.PENDENTE_TAXA,
        StatusMatricula.AGUARDANDO_CONFIRMACAO,
        StatusMatricula.ATIVA,
      ]);
    });
  });

  describe('buildSeatOccupancyWhereClause', () => {
    const referenceDate = new Date('2026-07-03T12:00:00.000Z');

    it('inclui status base e pausa com retencao de vaga', () => {
      const where = buildSeatOccupancyWhereClause(referenceDate);

      expect(where.AND[0]).toEqual({
        OR: [
          {
            status: {
              in: [
                StatusMatricula.PENDENTE_TAXA,
                StatusMatricula.AGUARDANDO_CONFIRMACAO,
                StatusMatricula.ATIVA,
              ],
            },
          },
          {
            status: StatusMatricula.PAUSADA,
            manterVaga: true,
          },
        ],
      });
    });

    it('exclui matriculas futuras e vencidas da ocupacao atual', () => {
      const where = buildSeatOccupancyWhereClause(referenceDate);

      expect(where.AND[1]).toEqual({ dataInicio: { lte: referenceDate } });
      expect(where.AND[2]).toEqual({ dataFimContrato: { gte: referenceDate } });
    });
  });

  describe('buildSeatOccupancyOverlapWhereClause', () => {
    it('detecta qualquer interseção entre o período existente e o novo contrato', () => {
      const start = new Date('2027-01-10T12:00:00.000Z');
      const end = new Date('2027-12-10T12:00:00.000Z');
      const where = buildSeatOccupancyOverlapWhereClause(start, end);

      expect(where.AND[1]).toEqual({ dataInicio: { lte: end } });
      expect(where.AND[2]).toEqual({ dataFimContrato: { gte: start } });
    });
  });

  describe('calcularVagasDisponiveis', () => {
    it('calcula turma com vagas sem alerta', () => {
      expect(calcularVagasDisponiveis(30, 20)).toEqual({
        disponiveis: 10,
        temVaga: true,
        alerta: false,
      });
    });

    it('alerta quando restam duas vagas ou menos', () => {
      expect(calcularVagasDisponiveis(30, 28)).toEqual({
        disponiveis: 2,
        temVaga: true,
        alerta: true,
        mensagem: '⚠️ Apenas 2 vaga(s) restante(s)',
      });
      expect(calcularVagasDisponiveis(30, 29)).toEqual({
        disponiveis: 1,
        temVaga: true,
        alerta: true,
        mensagem: '⚠️ Apenas 1 vaga(s) restante(s)',
      });
    });

    it('nao deixa vagas negativas', () => {
      expect(calcularVagasDisponiveis(30, 30)).toEqual({
        disponiveis: 0,
        temVaga: false,
        alerta: true,
        mensagem: 'Turma sem vagas disponíveis',
      });
      expect(calcularVagasDisponiveis(30, 35)).toEqual({
        disponiveis: 0,
        temVaga: false,
        alerta: true,
        mensagem: 'Turma sem vagas disponíveis',
      });
    });
  });
});
