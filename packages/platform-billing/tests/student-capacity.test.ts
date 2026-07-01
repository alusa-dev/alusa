import { describe, expect, it } from 'vitest';
import {
  PlatformBillingError,
  assertStudentCapacityDomain,
  evaluateStudentCapacity,
  recommendPlatformPlanForActiveStudents,
} from '../src';

describe('@alusa/platform-billing student capacity', () => {
  it('permite Starter com 59 + 1 e bloqueia 59 + 2', () => {
    expect(evaluateStudentCapacity({
      contaId: 'conta_1',
      planCode: 'STARTER',
      activeStudents: 59,
      additionalActiveStudents: 1,
    }).allowed).toBe(true);

    const result = evaluateStudentCapacity({
      contaId: 'conta_1',
      planCode: 'STARTER',
      activeStudents: 59,
      additionalActiveStudents: 2,
    });

    expect(result.allowed).toBe(false);
    expect(result.maxActiveStudents).toBe(60);
    expect(result.recommendedPlanCode).toBe('PREMIUM');
  });

  it('recomenda CUSTOM acima de 300 alunos ativos', () => {
    expect(recommendPlatformPlanForActiveStudents(301)).toBe('CUSTOM');
  });

  it('erro de domínio carrega plano, limite, uso e recomendado', () => {
    try {
      assertStudentCapacityDomain({
        contaId: 'conta_1',
        planCode: 'PREMIUM',
        activeStudents: 150,
        additionalActiveStudents: 1,
      });
      throw new Error('should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformBillingError);
      expect((error as PlatformBillingError).code).toBe('PLATFORM_BILLING_STUDENT_CAPACITY_EXCEEDED');
      expect((error as PlatformBillingError).details).toMatchObject({
        planCode: 'PREMIUM',
        maxActiveStudents: 150,
        activeStudents: 150,
        projectedActiveStudents: 151,
        recommendedPlanCode: 'PRO',
      });
    }
  });
});
