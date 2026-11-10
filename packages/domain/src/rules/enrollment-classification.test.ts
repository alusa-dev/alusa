import { describe, expect, it } from 'vitest';
import { classifyEnrollment } from './enrollment-classification.js';

const base = {
  formalTransfer: false,
  pendingTransferWithEvidence: false,
  historyReliable: true,
  hasEffectiveEnrollmentInCourse: true,
  definitiveBreak: false,
  provenUnjustifiedGap: false,
  immediatelyNextCycle: false,
};

describe('classifyEnrollment', () => {
  it('prioritizes formal transfer', () => expect(classifyEnrollment({ ...base, formalTransfer: true }).classification).toBe('TRANSFERENCIA'));
  it('keeps a transfer with concrete pending evidence indeterminate until formalized', () => {
    expect(classifyEnrollment({ ...base, pendingTransferWithEvidence: true })).toEqual({
      classification: 'HISTORICO_INDETERMINADO',
      reasonCode: 'TRANSFERENCIA_PENDENTE',
    });
  });
  it('keeps incomplete history indeterminate', () => expect(classifyEnrollment({ ...base, historyReliable: false, definitiveBreak: true }).classification).toBe('HISTORICO_INDETERMINADO'));
  it('marks supported interruption as return', () => expect(classifyEnrollment({ ...base, provenUnjustifiedGap: true }).classification).toBe('RETORNO'));
  it('marks the next cycle as renewal', () => expect(classifyEnrollment({ ...base, immediatelyNextCycle: true }).classification).toBe('REMATRICULA'));
  it('marks first effective course link only with reliable history', () => expect(classifyEnrollment({ ...base, hasEffectiveEnrollmentInCourse: false }).classification).toBe('PRIMEIRO_INGRESSO'));
  it('does not treat an unreconciled legacy snapshot as first entry', () => expect(classifyEnrollment({ ...base, historyReliable: false, hasEffectiveEnrollmentInCourse: false })).toMatchObject({ classification: 'HISTORICO_INDETERMINADO', reasonCode: 'HISTORICO_INSUFICIENTE' }));
  it('does not infer a new category from inconsistent history', () => expect(classifyEnrollment(base).classification).toBe('HISTORICO_INDETERMINADO'));
  it('rejects a claimed break without a prior effective enrollment', () => expect(classifyEnrollment({ ...base, hasEffectiveEnrollmentInCourse: false, definitiveBreak: true })).toMatchObject({ classification: 'HISTORICO_INDETERMINADO', reasonCode: 'HISTORICO_INCONSISTENTE' }));
});
