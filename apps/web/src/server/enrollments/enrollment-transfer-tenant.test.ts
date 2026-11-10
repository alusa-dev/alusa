import { describe, expect, it, vi } from 'vitest';
import { assertMatriculaCreationPreflight, MatriculaConflictError } from './enrollment.service';

describe('enrollment transfer tenant isolation', () => {
  it('rejects a foreign transfer source under the authenticated tenant without writes', async () => {
    const sourceFind = vi.fn().mockResolvedValue(null);
    const matriculaCreate = vi.fn();
    const destination = {
      id: 'class-a', nome: 'Turma A', modalidadeId: 'course-a', cicloAcademicoId: 'cycle-2',
      capacidade: 20, diasSemana: [], horaInicio: null, horaFim: null,
    };
    const db = {
      aluno: { findFirst: vi.fn().mockResolvedValue({ id: 'student-a', status: 'ATIVO', dataNasc: new Date('2000-01-01') }) },
      plano: { findFirst: vi.fn() },
      combo: { findFirst: vi.fn() },
      turma: { findFirst: vi.fn().mockResolvedValue(destination) },
      matricula: { findFirst: vi.fn().mockResolvedValue(null), create: matriculaCreate },
      matriculaVinculoAcademico: { findFirst: sourceFind },
      transferenciaAcademicaVinculo: { findFirst: vi.fn(), create: vi.fn() },
    };
    const start = new Date();
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);

    await expect(assertMatriculaCreationPreflight({
      contaId: 'tenant-a', alunoId: 'student-a', turmaId: 'class-a',
      transferenciaOrigemVinculoId: 'link-foreign', transferenciaMotivo: 'Transferência formal',
      dataInicio: start, dataFimContrato: end, vencimentoDia: 5,
      taxaMatricula: 0, taxaIsenta: true, pagarTaxaAgora: false,
      gerarCobrancaTaxa: false, criarCobranca: false, createdById: 'admin-a', modeloId: 'model-a',
    }, db as never)).rejects.toMatchObject({
      name: 'MatriculaConflictError', code: 'TRANSFERENCIA_ORIGEM_INVALIDA',
    } satisfies Partial<MatriculaConflictError>);

    expect(sourceFind).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'link-foreign', contaId: 'tenant-a' },
    }));
    expect(matriculaCreate).not.toHaveBeenCalled();
  });

  it('accepts an effective same-student transfer to a tenant class without an academic cycle', async () => {
    const sourceFind = vi.fn().mockResolvedValue({
      id: 'link-a', modalidadeId: 'course-a', vigenciaIniciadaEm: new Date('2025-01-01'),
      matricula: { alunoId: 'student-a' },
    });
    const destination = {
      id: 'class-b', nome: 'Jazz', modalidadeId: 'course-b', cicloAcademicoId: null,
      capacidade: 20, diasSemana: [], horaInicio: null, horaFim: null,
    };
    const db = {
      aluno: { findFirst: vi.fn().mockResolvedValue({ id: 'student-a', status: 'ATIVO', dataNasc: new Date('2000-01-01') }) },
      plano: { findFirst: vi.fn() },
      combo: { findFirst: vi.fn() },
      turma: { findFirst: vi.fn().mockResolvedValue(destination) },
      matricula: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      matriculaVinculoAcademico: { findFirst: sourceFind },
      transferenciaAcademicaVinculo: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    };
    const start = new Date();
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);

    await expect(assertMatriculaCreationPreflight({
      contaId: 'tenant-a', alunoId: 'student-a', turmaId: 'class-b',
      transferenciaOrigemVinculoId: 'link-a', transferenciaMotivo: 'Mudança de curso',
      dataInicio: start, dataFimContrato: end, vencimentoDia: 5,
      taxaMatricula: 0, taxaIsenta: true, pagarTaxaAgora: false,
      gerarCobrancaTaxa: false, criarCobranca: false, createdById: 'admin-a', modeloId: 'model-a',
    }, db as never)).resolves.toMatchObject({ targetTurmas: [{ id: 'class-b', cicloAcademicoId: null }] });

    expect(sourceFind).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'link-a', contaId: 'tenant-a' },
    }));
  });
});
