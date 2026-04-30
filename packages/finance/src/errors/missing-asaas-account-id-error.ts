export class MissingAsaasAccountIdError extends Error {
  readonly code = 'ASAAS_ACCOUNT_ID_REQUIRED';

  constructor(message: string = 'asaasAccountId é obrigatório para atualizar a subconta no Asaas.') {
    super(message);
    this.name = 'MissingAsaasAccountIdError';
  }
}
