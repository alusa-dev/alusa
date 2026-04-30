import { describe, expect, it } from 'vitest';
import { buildTurmaOccupancyMatriculaWhere } from './turma.service';

describe('buildTurmaOccupancyMatriculaWhere', () => {
  it('combina regra de ocupacao + escopo da conta + vinculo de turma via AND', () => {
    const where = buildTurmaOccupancyMatriculaWhere('conta-1', ['turma-1', 'turma-2']);

    expect(where).toHaveProperty('AND');
    expect(Array.isArray(where.AND)).toBe(true);
    expect(where.AND).toHaveLength(3);

    const [seatRule, tenantScope, turmaScope] = where.AND as Array<Record<string, unknown>>;

    expect(seatRule).toHaveProperty('OR');
    expect(tenantScope).toEqual({ aluno: { contaId: 'conta-1' } });
    expect(turmaScope).toEqual({
      OR: [
        { turmaId: { in: ['turma-1', 'turma-2'] } },
        { matriculaTurmas: { some: { turmaId: { in: ['turma-1', 'turma-2'] } } } },
      ],
    });
  });
});
