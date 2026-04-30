import { AsaasHttpError } from '@alusa/asaas';

function extractAsaasErrorMessage(error: AsaasHttpError): string | null {
  const responseBody = error.responseBody;

  if (!responseBody || typeof responseBody !== 'object') {
    return null;
  }

  const directMessage =
    'message' in responseBody && typeof responseBody.message === 'string'
      ? responseBody.message
      : null;
  if (directMessage) {
    return directMessage;
  }

  const errors =
    'errors' in responseBody && Array.isArray(responseBody.errors)
      ? responseBody.errors
      : [];

  const descriptions = errors
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      if ('description' in item && typeof item.description === 'string') {
        return item.description;
      }
      if ('message' in item && typeof item.message === 'string') {
        return item.message;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));

  return descriptions.length ? descriptions.join(', ') : null;
}

export type ClassifiedSubscriptionMutationError =
  | { kind: 'not_found'; providerMessage: string | null; providerStatus: number }
  | { kind: 'unauthorized'; providerMessage: string | null; providerStatus: number }
  | { kind: 'not_editable'; providerMessage: string | null; providerStatus: number }
  | { kind: 'unknown'; providerMessage: string | null; providerStatus: number | null };

export function classifyAsaasSubscriptionMutationError(
  error: unknown,
): ClassifiedSubscriptionMutationError {
  if (error instanceof AsaasHttpError) {
    const providerMessage = extractAsaasErrorMessage(error);

    if (error.status === 404) {
      return { kind: 'not_found', providerMessage, providerStatus: error.status };
    }

    if (error.status === 401 || error.status === 403) {
      return { kind: 'unauthorized', providerMessage, providerStatus: error.status };
    }

    if (error.status === 400 || error.status === 409 || error.status === 422) {
      return { kind: 'not_editable', providerMessage, providerStatus: error.status };
    }

    return { kind: 'unknown', providerMessage, providerStatus: error.status };
  }

  return {
    kind: 'unknown',
    providerMessage: error instanceof Error ? error.message : String(error),
    providerStatus: null,
  };
}
