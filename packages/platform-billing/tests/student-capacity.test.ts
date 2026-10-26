import { describe, expect, it } from 'vitest';
import { assertStudentCapacityDomain, evaluateStudentCapacity } from '../src';

describe('@alusa/platform-billing student capacity', () => {
  it('does not impose plan capacity limits on enrollment growth', () => {
    expect(evaluateStudentCapacity({
      contaId: 'conta_1',
      planCode: 'STARTER',
      activeStudents: 59,
      additionalActiveStudents: 1,
    }).allowed).toBe(true);

    const result = evaluateStudentCapacity({
      contaId: 'conta_1',
      planCode: 'STARTER',
      activeStudents: 500,
      additionalActiveStudents: 25,
    });

    expect(result.allowed).toBe(true);
    expect(result.maxActiveStudents).toBeNull();
    expect(result.recommendedPlanCode).toBeNull();
  });

  it('domain assertion permits growth above previous plan limits', () => {
    expect(assertStudentCapacityDomain({
      contaId: 'conta_1',
      planCode: 'PREMIUM',
      activeStudents: 151,
      additionalActiveStudents: 1,
    }).allowed).toBe(true);
  });
});
