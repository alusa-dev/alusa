export type EnrollmentTransferValidationInput = {
  sourceFound: boolean;
  sourceStudentId: string | null;
  expectedStudentId: string;
  sourceCourseId: string | null;
  destinationCourseIds: string[];
  sourceEffective: boolean;
  alreadyTransferred: boolean;
};

export type EnrollmentTransferValidationError =
  | 'SOURCE_NOT_FOUND'
  | 'STUDENT_MISMATCH'
  | 'SOURCE_NOT_EFFECTIVE'
  | 'SAME_COURSE'
  | 'DESTINATION_COURSE_AMBIGUOUS'
  | 'SOURCE_ALREADY_TRANSFERRED';

export function validateEnrollmentTransfer(input: EnrollmentTransferValidationInput): { valid: true } | { valid: false; error: EnrollmentTransferValidationError } {
  if (!input.sourceFound) return { valid: false, error: 'SOURCE_NOT_FOUND' };
  if (input.sourceStudentId !== input.expectedStudentId) return { valid: false, error: 'STUDENT_MISMATCH' };
  if (!input.sourceEffective) return { valid: false, error: 'SOURCE_NOT_EFFECTIVE' };
  if (input.destinationCourseIds.length !== 1) return { valid: false, error: 'DESTINATION_COURSE_AMBIGUOUS' };
  if (input.sourceCourseId === input.destinationCourseIds[0]) return { valid: false, error: 'SAME_COURSE' };
  if (input.alreadyTransferred) return { valid: false, error: 'SOURCE_ALREADY_TRANSFERRED' };
  return { valid: true };
}
