export class MissingCompanyTypeError extends Error {
  readonly code = 'MISSING_COMPANY_TYPE' as const;

  constructor() {
    super('Tipo da empresa é obrigatório para Pessoa Jurídica.');
    this.name = 'MissingCompanyTypeError';
  }
}
