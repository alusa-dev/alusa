import { describe, expect, it, vi } from 'vitest';

import { countAdditionalActiveStudentsForEnrollment } from './capacity';
import { countActivePlatformBillingStudents } from './platform-billing-server';

describe('platform student capacity with future enrollments', () => {
  it('counts distinct pupils with paid cycle enrollments across periodicities', async () => {
    const tx = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }) },
      $queryRaw: vi.fn().mockResolvedValue([{ studentCount: 6n, historyInconclusive: false }]),
    };

    await expect(countActivePlatformBillingStudents({ tx: tx as never, contaId: 'conta-a' })).resolves.toBe(6);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    const query = tx.$queryRaw.mock.calls[0];
    expect(query[0].join('?')).toContain('m."contaId" = ?');
    expect(query[0].join('')).toContain('COUNT(DISTINCT "alunoId")');
    expect(query[0].join('')).toContain('"studentUpdatedAt" >');
    expect(query[0].join('')).toContain('"comboUpdatedAt" >');
    expect(query[0].join('')).toContain('"planUpdatedAt" >');
    expect(query[0].join('')).toContain('"latestDiscountCreatedAt" >');
    expect(query[0].join('?')).toMatch(/BOOL_OR\(\s*"dataInicio"::date <= \?::date AND\s*\(/);
    expect(query[0].join('?')).not.toContain('BOOL_OR("activeAtDate"');
    expect(query).toContain('conta-a');
  });

  it('excludes future legacy ATIVA rows and counts students with an effective enrollment once', async () => {
    const tx = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      $queryRaw: vi.fn().mockResolvedValue([{ studentCount: 1n, historyInconclusive: false }]),
    };

    await expect(countActivePlatformBillingStudents({ tx: tx as never, contaId: 'conta-a' })).resolves.toBe(1);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
  });

  it('does not count an enrollment whose effective dates ended', async () => {
    const tx = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }) },
      $queryRaw: vi.fn().mockResolvedValue([{ studentCount: 0n, historyInconclusive: false }]),
    };

    await expect(countActivePlatformBillingStudents({ tx: tx as never, contaId: 'conta-a' })).resolves.toBe(0);
  });

  it('does not treat a future legacy ATIVA enrollment as an existing active student', async () => {
    const tx = {
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      aluno: { findFirst: vi.fn().mockResolvedValue({ id: 'student-1' }) },
      matricula: { findMany: vi.fn().mockResolvedValue([{ id: 'legacy-future', dataInicio: new Date('2099-11-01T12:00:00.000Z') }]) },
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
