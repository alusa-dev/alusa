export type EnsureAsaasCustomerError =
  | 'MISSING_KEY'
  | 'DECRYPT_FAILED'
  | 'INVALID_KEY'
  | 'TEMPORARY_ERROR'
  | 'PAYER_INVALID'
  | 'ASAAS_ERROR';

export class AsaasCustomerEnsureError extends Error {
  constructor(
    public readonly code: EnsureAsaasCustomerError,
    message: string,
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = 'AsaasCustomerEnsureError';
  }
}
