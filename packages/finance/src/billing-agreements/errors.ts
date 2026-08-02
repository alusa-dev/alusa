export type BillingAgreementErrorCode =
  | 'AGREEMENT_NOT_FOUND'
  | 'TARGET_AGREEMENT_NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'INVALID_INPUT'
  | 'ALLOCATION_NOT_FOUND'
  | 'AGREEMENT_VERSION_CONFLICT'
  | 'PREVIEW_EXPIRED'
  | 'PREVIEW_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'OPERATION_BUSY'
  | 'REMOTE_STATE_DIVERGED'
  | 'REMOTE_OPERATION_UNCERTAIN'
  | 'REMOTE_OPERATION_FAILED'
  | 'LOCAL_COMMIT_CONFLICT';

export class BillingAgreementError extends Error {
  readonly code: BillingAgreementErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BillingAgreementErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BillingAgreementError';
    this.code = code;
    this.details = details;
  }
}

export function isUncertainRemoteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|econnreset|etimedout|eai_again|socket hang up|network|fetch failed|und_err_connect_timeout|resultado_incerto/i.test(
    message,
  );
}
