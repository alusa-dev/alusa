import { describe, expect, it, vi } from 'vitest';

import { countAdditionalActiveStudentsForEnrollment } from './capacity';
import { countActivePlatformBillingStudents } from './platform-billing-server';

describe('platform student capacity with future enrollments', () => {
  it('counts distinct pupils with partial scholarship or another billed enrollment, excluding only fully covered/nonmonthly/zero rows', async () => {
    const tx = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }) },
      matricula: { findMany: vi.fn().mockResolvedValue([
        monthlyEnrollment('partial', new Date('2020-01-01T00:00:00Z'), 200, [{ valorFinal: 40 }]),
        monthlyEnrollment('partial', new Date('2020-01-01T00:00:00Z'), 200),
        monthlyEnrollment('full-only', new Date('2020-01-01T00:00:00Z'), 200, [{ valorFinal: 200 }]),
        monthlyEnrollment('full-and-billed', new Date('2020-01-01T00:00:00Z'), 200, [{ valorFinal: 200 }]),
        monthlyEnrollment('full-and-billed', new Date('2020-01-01T00:00:00Z'), 100),
        monthlyEnrollment('zero', new Date('2020-01-01T00:00:00Z'), 0),
        monthlyEnrollment('annual', new Date('2020-01-01T00:00:00Z'), 200, [], 'ANUAL'),
      ]) },
    };

    await expect(countActivePlatformBillingStudents({ tx: tx as never, contaId: 'conta-a' })).resolves.toBe(2);
    expect(tx.matricula.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-a', status: 'ATIVA', aluno: { status: 'ATIVO' } },
    }));
  });

  it('excludes future legacy ATIVA rows and counts students with an effective enrollment once', async () => {
    const tx = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      matricula: {
        findMany: vi.fn().mockResolvedValue([
          monthlyEnrollment('student-future', new Date('2099-11-01T12:00:00.000Z')),
          monthlyEnrollment('student-current', new Date('2020-01-01T12:00:00.000Z')),
          monthlyEnrollment('student-current', new Date('2099-11-01T12:00:00.000Z')),
        ]),
      },
    };

    await expect(countActivePlatformBillingStudents({ tx: tx as never, contaId: 'conta-a' })).resolves.toBe(1);
    expect(tx.matricula.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-a', status: 'ATIVA', aluno: { status: 'ATIVO' } },
      select: expect.objectContaining({
        alunoId: true,
        dataInicio: true,
        plano: { select: { valor: true, periodicidade: true } },
        combo: { select: { valor: true, periodicidade: true } },
      }),
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

function monthlyEnrollment(
  alunoId: string,
  dataInicio: Date,
  valor = 200,
  descontos: Array<{ valorFinal: number }> = [],
  periodicidade = 'MENSAL',
) {
  return {
    alunoId,
    dataInicio,
    plano: { valor, periodicidade },
    combo: null,
    descontos,
  };
}
