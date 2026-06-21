import { ApiError, mapStatusToCode } from './errors';
import type { ApiClientOptions, ApiRequestOptions } from './types';

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
};

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function parseErrorPayload(payload: unknown): ErrorPayload {
  return payload && typeof payload === 'object' ? (payload as ErrorPayload) : {};
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 12000;

  async function request<TResponse, TBody = unknown>({
    method = 'GET',
    path,
    body,
    signal,
    headers,
    timeoutMs = defaultTimeoutMs,
    accessToken,
  }: ApiRequestOptions<TBody>): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);

    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) abortFromCaller();
      signal.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      const response = await fetchImpl(joinUrl(options.baseUrl, path), {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(body == null ? null : { 'Content-Type': 'application/json' }),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : null),
          ...headers,
        },
        body: body == null ? undefined : JSON.stringify(body),
      });

      const requestId = response.headers.get('x-request-id') ?? undefined;
      const contentType = response.headers.get('content-type') ?? '';
      const hasJson = contentType.includes('application/json');
      const payload = hasJson ? await response.json().catch(() => null) : null;

      if (!response.ok) {
        const errorPayload = parseErrorPayload(payload);
        const code = mapStatusToCode(response.status);
        if (code === 'UNAUTHORIZED') {
          await options.onUnauthorized?.();
        }

        throw new ApiError({
          code,
          status: response.status,
          requestId,
          details: errorPayload.error?.details ?? payload,
          message:
            errorPayload.error?.message ??
            errorPayload.message ??
            'Não foi possível concluir a solicitação.',
        });
      }

      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as TResponse;
      }

      return payload as TResponse;
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (controller.signal.aborted) {
        throw new ApiError({
          code: 'TIMEOUT',
          message: 'A conexão demorou mais que o esperado. Tente novamente.',
        });
      }

      throw new ApiError({
        code: 'NETWORK_ERROR',
        message: 'Não foi possível conectar à Alusa. Verifique sua internet.',
        details: error,
      });
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abortFromCaller);
    }
  }

  return { request };
}
