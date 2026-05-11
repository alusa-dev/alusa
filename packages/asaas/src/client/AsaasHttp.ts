/**
 * Cliente HTTP base para API do Asaas
 * 
 * Responsabilidades:
 * - Executar requisições HTTP
 * - Adicionar headers de autenticação
 * - Tratar erros HTTP
 * 
 * Não contém:
 * - Lógica de negócio
 * - Persistência
 * - Mapeamento de status
 */

import { getAsaasBaseUrlForApiKeyOrThrow } from './asaasBaseUrl';
import { globalGetLimiter } from './concurrency-limiter';
import { extractRateLimitHeaders, globalRateLimitTracker } from './rate-limit-tracker';
import { globalCircuitBreaker, CircuitOpenError } from './circuit-breaker';
import { globalQuotaTracker } from './quota-tracker';
import { globalAsaasHooks } from './asaas-hooks';

export interface AsaasHttpConfig {
  apiKey: string;
}

export interface AsaasHttpOptions {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
}

export class AsaasHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = 'AsaasHttpError';
  }
}

// Base URL validada/normalizada via helper central.

export class AsaasHttp {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AsaasHttpConfig) {
    this.apiKey = config.apiKey;
    // A API key define o ambiente efetivo para evitar validar chaves de produção em sandbox e vice-versa.
    this.baseUrl = getAsaasBaseUrlForApiKeyOrThrow(config.apiKey);
  }

  async get<T>(path: string, options?: AsaasHttpOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: AsaasHttpOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T>(path: string, body?: unknown, options?: AsaasHttpOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  async delete<T>(path: string, options?: AsaasHttpOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: AsaasHttpOptions,
  ): Promise<T> {
    const startedAt = Date.now();

    // Circuit breaker check (keyed por apiKey hash parcial)
    const circuitKey = this.apiKey.slice(-12);
    const circuitCheck = globalCircuitBreaker.canExecute(circuitKey);
    if (!circuitCheck.allowed) {
      throw new CircuitOpenError(circuitKey, circuitCheck.waitMs ?? 0);
    }

    // Quota tracking
    globalQuotaTracker.increment(circuitKey);

    // Garantir que base termina com / para que new URL() não "coma" o /v3
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(normalizedPath, base);

    // Query params
    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

    const headers: Record<string, string> = {
      'access_token': this.apiKey,
      'User-Agent': 'Alusa/1.0',
      'Accept': 'application/json',
      ...options?.headers,
    };

    // Content-Type apenas quando temos body JSON (não FormData)
    if (!isFormData && body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchFn = () => requestWithRetry(url.toString(), {
      method,
      headers,
      body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
    });

    // Semáforo de concorrência para GETs (Asaas limita a 50 concorrentes)
    const response = method === 'GET'
      ? await globalGetLimiter.run(fetchFn)
      : await fetchFn();

    // Capturar e registrar headers de rate limit do Asaas
    const rateLimitInfo = extractRateLimitHeaders(response.headers);
    const endpointClass = url.pathname.split('/').slice(0, 4).join('/');
    globalRateLimitTracker.update(endpointClass, rateLimitInfo);

    if (process.env.ASAAS_HTTP_LOG === 'true') {
      const elapsedMs = Date.now() - startedAt;
      // Nunca logar apiKey/access_token.
      console.info('[asaas.http]', {
        method,
        path: url.pathname,
        status: response.status,
        elapsedMs,
        rateLimit: rateLimitInfo.remaining !== null ? {
          limit: rateLimitInfo.limit,
          remaining: rateLimitInfo.remaining,
          resetSeconds: rateLimitInfo.resetSeconds,
        } : undefined,
      });
    }

    const contentType = response.headers.get('content-type') ?? '';
    let data: unknown = null;

    let rawText = '';
    try {
      rawText = await response.text();
    } catch {
      rawText = '';
    }

    const isEmptyBody = rawText.length === 0;

    if (rawText.length > 0) {
      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = rawText;
        }
      } else {
        data = rawText;
      }
    } else {
      // Body vazio - criar objeto diagnóstico
      data = {
        _emptyBody: true,
        statusText: response.statusText || 'Empty response',
        contentType,
      };
    }

    if (!response.ok) {
      // Registrar falha no circuit breaker
      globalCircuitBreaker.recordFailure(circuitKey, response.status);

      // Log diagnóstico para erros — inclui request body para depuração
      if (isEmptyBody || response.status >= 400) {
        console.warn('[asaas.http] Resposta de erro', {
          method,
          path: url.pathname,
          status: response.status,
          statusText: response.statusText,
          contentType,
          emptyBody: isEmptyBody,
          requestBodyPreview: body
            ? JSON.stringify(body).slice(0, 500)
            : undefined,
          idempotencyKey: options?.headers?.['Idempotency-Key'] ?? undefined,
        });
      }

      // Hook para observabilidade em erro
      globalAsaasHooks.emitApiCall({
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        endpoint: url.pathname,
        accountKey: circuitKey,
        httpStatus: response.status,
        durationMs: Date.now() - startedAt,
        success: false,
        error: `HTTP ${response.status}`,
        circuitState: globalCircuitBreaker.getState(circuitKey),
        rateLimitRemaining: rateLimitInfo.remaining ?? undefined,
        quotaRemaining: globalQuotaTracker.getStatus(circuitKey).remaining,
      });

      const errorMessage = this.extractErrorMessage(data);
      throw new AsaasHttpError(
        errorMessage || `Asaas API error: ${response.status}`,
        response.status,
        data,
        data,
      );
    }

    // Registrar sucesso no circuit breaker
    globalCircuitBreaker.recordSuccess(circuitKey);

    // Hook para observabilidade externa (api-logger, alertas)
    globalAsaasHooks.emitApiCall({
      method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
      endpoint: url.pathname,
      accountKey: circuitKey,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      success: true,
      circuitState: globalCircuitBreaker.getState(circuitKey),
      rateLimitRemaining: rateLimitInfo.remaining ?? undefined,
      quotaRemaining: globalQuotaTracker.getStatus(circuitKey).remaining,
    });

    return data as T;
  }

  private extractErrorMessage(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;

    const obj = data as Record<string, unknown>;

    // Formato padrão Asaas: { errors: [{ description: "..." }] }
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const firstError = obj.errors[0];
      if (typeof firstError === 'object' && firstError && 'description' in firstError) {
        return String(firstError.description);
      }
    }

    // Fallback: message ou error
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;

    return null;
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Pode ser delta-seconds
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  // Ou HTTP-date
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

function jitter(ms: number): number {
  // jitter simples: +/- 20%
  const variance = ms * 0.2;
  const delta = (Math.random() * 2 - 1) * variance;
  return Math.max(0, Math.round(ms + delta));
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const maxAttempts = 3;
  const baseDelaysMs = [200, 500, 1000];

  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, init);
    lastResponse = response;

    const status = response.status;
    // 408 (Read Timed Out) é retryable — doc Asaas: endpoint de webhook com > 10s
    const shouldRetry = status === 408 || status === 429 || (status >= 500 && status <= 599);
    if (!shouldRetry) return response;

    if (attempt === maxAttempts) return response;

    const retryAfterHeader = response.headers?.get?.('retry-after') ?? null;
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    const delayMs = retryAfterMs ?? jitter(baseDelaysMs[attempt - 1] ?? 1000);
    await sleep(delayMs);
  }

  // fallback (nunca deve acontecer)
  return lastResponse as Response;
}
