import { describe, expect, it, vi } from 'vitest';

import { countAdditionalActiveStudentsForEnrollment } from './capacity';
import { countActivePlatformBillingStudents } from './platform-billing-server';

describe('platform student capacity with future enrollments', () => {
  it('excludes future legacy ATIVA rows and counts students with an effective enrollment once', async () => {
    const tx = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      matricula: {
        findMany: vi.fn().mockResolvedValue([
          { alunoId: 'student-future', dataInicio: new Date('2099-11-01T12:00:00.000Z') },
          { alunoId: 'student-current', dataInicio: new Date('2020-01-01T12:00:00.000Z') },
          { alunoId: 'student-current', dataInicio: new Date('2099-11-01T12:00:00.000Z') },
        ]),
      },
    };

    await expect(countActivePlatformBillingStudents({ tx: tx as never, contaId: 'conta-a' })).resolves.toBe(1);
    expect(tx.matricula.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-a', status: 'ATIVA', aluno: { status: 'ATIVO' } },
      select: { alunoId: true, dataInicio: true },
    }));
  });

  it('does not treat a future legacy ATIVA enrollment as an existing active student', async () => {
    const tx = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      aluno: { findFirst: vi.fn().mockResolvedValue({ id: 'student-1' }) },
      matricula: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'legacy-future', dataInicio: new Date('2099-11-01T12:00:00.000Z') },
        ]),
      },
    };

    await expect(countAdditionalActiveStudentsForEnrollment({
      tx: tx as never,
      contaId: 'conta-a',
      alunoId: 'student-1',
    })).resolves.toBe(1);
    expect(tx.matricula.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-a', alunoId: 'student-1', status: 'ATIVA' },
    }));
  });
});
