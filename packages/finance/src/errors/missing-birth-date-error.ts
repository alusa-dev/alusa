export class MissingBirthDateError extends Error {
  readonly code = 'BIRTH_DATE_REQUIRED';

  constructor() {
    super('O campo birthDate deve ser informado.');
  }
}
