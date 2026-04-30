export class MissingAsaasApiKeyError extends Error {
  readonly code = 'ASAAS_NOT_CONFIGURED' as const;

  constructor(message = 'Integração financeira não configurada') {
    super(message);
    this.name = 'MissingAsaasApiKeyError';
  }
}
