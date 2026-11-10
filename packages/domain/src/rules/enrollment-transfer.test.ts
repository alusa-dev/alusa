import { describe, expect, it } from 'vitest';
import { validateEnrollmentTransfer } from './enrollment-transfer.js';

const valid = {
  sourceFound: true,
  sourceStudentId: 'student-1',
  expectedStudentId: 'student-1',
  sourceCourseId: 'course-a',
  destinationCourseIds: ['course-b'],
  sourceEffective: true,
  alreadyTransferred: false,
};

describe('validateEnrollmentTransfer', () => {
  it('accepts a single course destination with an effective same-student source', () => expect(validateEnrollmentTransfer(valid)).toEqual({ valid: true }));
  it('rejects cross-student links', () => expect(validateEnrollmentTransfer({ ...valid, sourceStudentId: 'student-2' })).toMatchObject({ valid: false, error: 'STUDENT_MISMATCH' }));
  it('rejects an ineffective source', () => expect(validateEnrollmentTransfer({ ...valid, sourceEffective: false })).toMatchObject({ valid: false, error: 'SOURCE_NOT_EFFECTIVE' }));
  it('accepts an explicit transfer without a destination academic cycle', () => expect(validateEnrollmentTransfer(valid)).toEqual({ valid: true }));
  it('rejects multiple destination courses', () => expect(validateEnrollmentTransfer({ ...valid, destinationCourseIds: ['course-b', 'course-c'] })).toMatchObject({ valid: false, error: 'DESTINATION_COURSE_AMBIGUOUS' }));
  it('rejects reuse of an already transferred source', () => expect(validateEnrollmentTransfer({ ...valid, alreadyTransferred: true })).toMatchObject({ valid: false, error: 'SOURCE_ALREADY_TRANSFERRED' }));
});
