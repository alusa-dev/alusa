import { describe, expect, it, vi } from 'vitest';
import {
  findUnlinkedStudentIds,
  listStudentsLinkedToResponsible,
} from './linked-students.service';

describe('linked students service', () => {
  it('aplica contaId no vínculo e no aluno relacionado', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listStudentsLinkedToResponsible(
      { alunoResponsavel: { findMany } } as never,
      { contaId: 'conta-a', responsavelId: 'resp-1' },
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contaId: 'conta-a',
          responsavelId: 'resp-1',
          aluno: { contaId: 'conta-a' },
        },
      }),
    );
  });

  it('rejeita aluno ausente e vínculo pertencente a outra conta', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { alunoId: 'aluno-1', aluno: { id: 'aluno-1', nome: 'Ana' } },
    ]);
    const result = await findUnlinkedStudentIds(
      { alunoResponsavel: { findMany } } as never,
      {
        contaId: 'conta-a',
        responsavelId: 'resp-1',
        alunoIds: ['aluno-1', 'aluno-outra-conta'],
      },
    );
    expect(result).toEqual(['aluno-outra-conta']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-a',
          alunoId: { in: ['aluno-1', 'aluno-outra-conta'] },
          aluno: { contaId: 'conta-a' },
        }),
      }),
    );
  });
});
