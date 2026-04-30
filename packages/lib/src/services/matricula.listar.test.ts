// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const count = vi.fn();

vi.mock('@/prisma/client', () => ({
  prisma: {
    matricula: {
      findMany,
      count,
    },
  },
}));

const { listarMatriculas } = await import('./matricula');

const baseItem = {
  id: 'm1',
  status: 'ATIVA',
  statusFinanceiro: 'PENDENTE_TAXA',
  statusContrato: 'ATIVO',
  dataInicio: new Date('2025-01-01'),
  dataFim: null,
  dataFimContrato: new Date('2025-12-31'),
  taxaMatricula: 0,
  taxaStatus: 'PENDENTE',
  taxaIsenta: false,
  vencimentoDia: 5,
  aluno: { id: 'a1', nome: 'Aluno', cpf: null },
  plano: null,
  responsavelFinanceiro: null,
  turma: null,
  matriculaTurmas: [],
  combo: null,
  cobrancas: [],
};

describe('listarMatriculas', () => {
  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
    findMany.mockResolvedValue([baseItem]);
    count.mockResolvedValue(1);
  });

  it('aplica filtro de turma considerando vínculo de combo', async () => {
    await listarMatriculas({ contaId: 'conta-1', turmaId: 'turma-1' });

    expect(findMany).toHaveBeenCalled();
    const args = findMany.mock.calls[0]?.[0];
    const where = args?.where;
    expect(where).toBeDefined();

    const andConditions = where?.AND || [];
    const turmaFilter = andConditions.find((c: Record<string, unknown>) => c?.OR)?.OR;

    expect(turmaFilter).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ turmaId: 'turma-1' }),
        expect.objectContaining({ matriculaTurmas: { some: { turmaId: 'turma-1' } } }),
      ]),
    );
  });
});
