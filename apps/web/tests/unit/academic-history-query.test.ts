import { describe, expect, it } from 'vitest';
import { classifyEnrollment } from '@alusa/domain';
import { buildUnmappedPriorEnrollmentInCourseWhere, buildUnmappedPriorEnrollmentWhere, wasCancelledBeforeEffectiveStart } from '@/src/server/enrollments/academic-history-query';

describe('buildUnmappedPriorEnrollmentWhere', () => {
  it('matches only the course being classified across direct and many-to-many class links', () => {
    const where = buildUnmappedPriorEnrollmentWhere({
      contaId: 'tenant-1',
      alunoId: 'student-1',
      currentMatriculaId: 'current-enrollment',
      modalidadeId: 'ballet',
    });
    expect(where).toMatchObject({ contaId: 'tenant-1', alunoId: 'student-1', id: { not: 'current-enrollment' } });
    expect(where.OR).toEqual([
      { turma: { is: { modalidadeId: 'ballet' } } },
      { matriculaTurmas: { some: { turma: { is: { modalidadeId: 'ballet' } } } } },
    ]);
    expect(JSON.stringify(where.OR)).not.toContain('teatro');
  });
});

describe('buildUnmappedPriorEnrollmentInCourseWhere', () => {
  it('keeps other course links from hiding a legacy enrollment in the course being classified', () => {
    const where = buildUnmappedPriorEnrollmentInCourseWhere({
      contaId: 'tenant-1',
      alunoId: 'student-1',
      currentMatriculaId: 'current-enrollment',
      modalidadeId: 'theater',
    });
    expect(where.vinculosAcademicos).toEqual({ none: { modalidadeId: 'theater' } });
    expect(where.OR).toEqual([
      { turma: { is: { modalidadeId: 'theater' } } },
      { matriculaTurmas: { some: { turma: { is: { modalidadeId: 'theater' } } } } },
    ]);
  });
});

describe('wasCancelledBeforeEffectiveStart', () => {
  it('does not treat an enrollment cancelled before its start as effective history', () => {
    const cancelledBeforeStart = wasCancelledBeforeEffectiveStart({
      status: 'CANCELADA',
      cancelledAt: new Date('2025-01-02T00:00:00.000Z'),
      dataInicio: new Date('2025-02-01T00:00:00.000Z'),
    });
    expect(cancelledBeforeStart).toBe(true);
    expect(classifyEnrollment({
      formalTransfer: false,
      pendingTransferWithEvidence: false,
      historyReliable: true,
      hasEffectiveEnrollmentInCourse: !cancelledBeforeStart,
      definitiveBreak: false,
      provenUnjustifiedGap: false,
      immediatelyNextCycle: false,
    }).classification).toBe('PRIMEIRO_INGRESSO');
  });

  it('keeps cancellation after start as effective history evidence', () => {
    expect(wasCancelledBeforeEffectiveStart({
      status: 'CANCELADA',
      cancelledAt: new Date('2025-02-02T00:00:00.000Z'),
      dataInicio: new Date('2025-02-01T00:00:00.000Z'),
    })).toBe(false);
  });
});
