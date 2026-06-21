export type ApiErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(params: {
    code: ApiErrorCode;
    message: string;
    status?: number;
    requestId?: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAuthError(error: unknown) {
  return isApiError(error) && (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN');
}

export function mapStatusToCode(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422 || status === 400) return 'VALIDATION_ERROR';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN';
}
