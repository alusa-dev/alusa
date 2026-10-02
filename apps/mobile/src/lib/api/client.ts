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

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function requestIdFromHeaders(headers?: Record<string, string>) {
  const existing = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === 'x-request-id')?.[1]?.trim();
  return existing && /^[a-zA-Z0-9._-]{8,128}$/.test(existing) ? existing : createRequestId();
}

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 12000;

  async function request<TResponse, TBody = unknown>(
    requestOptions: ApiRequestOptions<TBody>,
    canRefresh = true,
  ): Promise<TResponse> {
    const requestId = requestIdFromHeaders(requestOptions.headers);
    const {
    method = 'GET',
    path,
    body,
    signal,
    headers,
    timeoutMs = defaultTimeoutMs,
    accessToken,
    } = requestOptions;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);

    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) abortFromCaller();
      signal.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      const resolvedAccessToken =
        accessToken !== undefined ? accessToken : await options.getAccessToken?.();
      const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
      const response = await fetchImpl(joinUrl(options.baseUrl, path), {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(body == null || isFormData ? null : { 'Content-Type': 'application/json' }),
          ...(resolvedAccessToken ? { Authorization: `Bearer ${resolvedAccessToken}` } : null),
          ...Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== 'x-request-id')),
          'x-request-id': requestId,
        },
        body: body == null ? undefined : isFormData ? body : JSON.stringify(body),
      });

      const responseRequestId = response.headers.get('x-request-id') ?? requestId;
      const contentType = response.headers.get('content-type') ?? '';
      const hasJson = contentType.includes('application/json');
      const payload = hasJson ? await response.json().catch(() => null) : null;

      if (!response.ok) {
        const errorPayload = parseErrorPayload(payload);
        const code = mapStatusToCode(response.status);
        if (code === 'UNAUTHORIZED' && canRefresh && options.refreshAccessToken) {
          const refreshedAccessToken = await options.refreshAccessToken();
          if (refreshedAccessToken) {
            return request({
              ...requestOptions,
              headers: { ...(requestOptions.headers ?? {}), 'x-request-id': requestId },
              accessToken: refreshedAccessToken,
            }, false);
          }
        }
        if (code === 'UNAUTHORIZED') {
          await options.onUnauthorized?.();
        }

        throw new ApiError({
          code,
          status: response.status,
          requestId: responseRequestId,
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
