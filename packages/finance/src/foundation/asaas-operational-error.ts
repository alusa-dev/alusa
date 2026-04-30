import { AsaasHttpError } from '@alusa/asaas';

export type AsaasOperationalErrorCategory =
  | 'invalid_master_credentials'
  | 'invalid_subaccount_credentials'
  | 'subaccount_not_found'
  | 'myaccount_not_found'
  | 'rate_limit_concurrency'
  | 'rate_limit_quota'
  | 'rate_limit_endpoint'
  | 'temporary_asaas_error'
  | 'unknown_error';

type Context = 'master' | 'subaccount';

type ErrorDetail = {
  code?: string;
  description?: string;
};

export type AsaasOperationalErrorInfo = {
  category: AsaasOperationalErrorCategory;
  status: number | null;
  message: string;
  details: ErrorDetail[];
  retryable: boolean;
};

function extractStatus(error: unknown): number | null {
  if (error instanceof AsaasHttpError) return error.status;
  if (typeof (error as { status?: unknown } | null)?.status === 'number') {
    return (error as { status: number }).status;
  }
  return null;
}

function extractDetails(error: unknown): ErrorDetail[] {
  const response = error instanceof AsaasHttpError ? error.responseBody ?? error.response : null;
  if (!response || typeof response !== 'object') return [];

  const rawErrors = (response as { errors?: unknown }).errors;
  if (!Array.isArray(rawErrors)) return [];

  return rawErrors.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : undefined;
    const description = typeof record.description === 'string' ? record.description : undefined;
    if (!code && !description) return [];
    return [{ ...(code ? { code } : {}), ...(description ? { description } : {}) }];
  });
}

function classifyRateLimit(details: ErrorDetail[]): AsaasOperationalErrorCategory {
  const text = details
    .map((detail) => `${detail.code ?? ''} ${detail.description ?? ''}`.trim().toLowerCase())
    .join(' ');

  if (text.includes('concurrent')) return 'rate_limit_concurrency';
  if (text.includes('quota') || text.includes('25,000') || text.includes('12 hours')) return 'rate_limit_quota';
  return 'rate_limit_endpoint';
}

export function classifyAsaasOperationalError(error: unknown, context: Context): AsaasOperationalErrorInfo {
  const status = extractStatus(error);
  const details = extractDetails(error);
  const message = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return {
      category: context === 'master' ? 'invalid_master_credentials' : 'invalid_subaccount_credentials',
      status,
      message,
      details,
      retryable: false,
    };
  }

  if (status === 404) {
    return {
      category: context === 'master' ? 'subaccount_not_found' : 'myaccount_not_found',
      status,
      message,
      details,
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      category: classifyRateLimit(details),
      status,
      message,
      details,
      retryable: true,
    };
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      category: 'temporary_asaas_error',
      status,
      message,
      details,
      retryable: true,
    };
  }

  return {
    category: 'unknown_error',
    status,
    message,
    details,
    retryable: false,
  };
}