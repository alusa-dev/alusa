import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    turma: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    cicloAcademico: { findFirst: vi.fn() },
    matricula: { findFirst: vi.fn() },
    matriculaTurma: { findFirst: vi.fn() },
  },
}));

vi.mock('../prisma', () => ({ prisma: prismaMock }));

import { isTurmaUsedByEnrollment, updateTurma } from './turma.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isTurmaUsedByEnrollment', () => {
  it('detects direct Matricula.turmaId usage', async () => {
    const findEnrollment = vi.fn().mockResolvedValue({ id: 'enrollment-1' });
    const findMembership = vi.fn();
    const used = await isTurmaUsedByEnrollment({
      matricula: { findFirst: findEnrollment },
      matriculaTurma: { findFirst: findMembership },
    } as never, { contaId: 'tenant-a', turmaId: 'class-1' });

    expect(used).toBe(true);
    expect(findEnrollment).toHaveBeenCalledWith({ where: { contaId: 'tenant-a', turmaId: 'class-1' }, select: { id: true } });
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('detects MatriculaTurma membership when no direct turmaId exists', async () => {
    const findEnrollment = vi.fn().mockResolvedValue(null);
    const findMembership = vi.fn().mockResolvedValue({ id: 'membership-1' });
    const used = await isTurmaUsedByEnrollment({
      matricula: { findFirst: findEnrollment },
      matriculaTurma: { findFirst: findMembership },
    } as never, { contaId: 'tenant-a', turmaId: 'class-1' });

    expect(used).toBe(true);
    expect(findMembership).toHaveBeenCalledWith({ where: { contaId: 'tenant-a', turmaId: 'class-1' }, select: { id: true } });
  });
});

describe('updateTurma academic cycle compatibility', () => {
  it('preserves an existing legacy cycle when an edit omits cicloAcademicoId', async () => {
    const current = {
      id: 'class-1',
      contaId: 'tenant-a',
      nome: 'Turma anterior',
      modalidadeId: 'clmodality1234567890123456',
      cicloAcademicoId: 'clcycle12345678901234567',
      salaId: 'clroom1234567890123456789',
      diasSemana: ['SEG'],
      horaInicio: '09:00',
      horaFim: '10:00',
      idadeMin: null,
      idadeMax: null,
      capacidade: 20,
      status: 'ATIVO',
      observacao: null,
    };
    prismaMock.turma.findFirst.mockImplementation(async ({ where }) => {
      if (where?.id === current.id) {
        return prismaMock.turma.updateMany.mock.calls.length
          ? { ...current, nome: 'Turma atualizada' }
          : current;
      }
      return null;
    });
    prismaMock.turma.findMany.mockResolvedValue([]);
    prismaMock.cicloAcademico.findFirst.mockResolvedValue({ id: current.cicloAcademicoId });
    prismaMock.turma.updateMany.mockResolvedValue({ count: 1 });

    await updateTurma({
      id: current.id,
      contaId: current.contaId,
      nome: 'Turma atualizada',
    });

    expect(prismaMock.turma.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: current.id, contaId: current.contaId },
        data: expect.objectContaining({ cicloAcademicoId: current.cicloAcademicoId }),
      }),
    );
  });
});
