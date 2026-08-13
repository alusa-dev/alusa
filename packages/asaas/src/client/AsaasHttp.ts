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
import { AsaasConcurrencyLimitError, globalGetLimiter } from './concurrency-limiter';
import { extractRateLimitHeaders, globalRateLimitTracker } from './rate-limit-tracker';
import { globalCircuitBreaker, CircuitOpenError } from './circuit-breaker';
import { AsaasQuotaExceededError, globalQuotaTracker, type QuotaStatus } from './quota-tracker';
import { globalAsaasHooks } from './asaas-hooks';
import { createAsaasAccountKey } from './account-key';

export interface AsaasHttpConfig {
  apiKey: string;
  /** Identificador opcional do tenant para observabilidade; nunca é usado como segredo. */
  accountScope?: string;
}

export interface AsaasHttpOptions {
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  /** Status HTTP tratados como ausência esperada (ex.: 404 em GET de recurso opcional). */
  expectedErrorStatuses?: number[];
}

export class AsaasApiKeyError extends Error {
  constructor(message = 'API key do Asaas inválida.') {
    super(message);
    this.name = 'AsaasApiKeyError';
  }
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
  private readonly accountKey: string;
  private readonly accountScope?: string;

  constructor(config: AsaasHttpConfig) {
    const apiKey = config.apiKey.trim();
    if (!apiKey || [...apiKey].some((character) => character.charCodeAt(0) > 0x7f)) {
      throw new AsaasApiKeyError(
        'API key do Asaas inválida. Cole somente a chave original, sem símbolos ou caracteres adicionais.',
      );
    }

    this.apiKey = apiKey;
    this.accountKey = createAsaasAccountKey(apiKey);
    this.accountScope = config.accountScope;
    // A API key define o ambiente efetivo para evitar validar chaves de produção em sandbox e vice-versa.
    this.baseUrl = getAsaasBaseUrlForApiKeyOrThrow(apiKey);
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

    // Todos os controles usam a mesma chave estável, sem expor fragmentos da API key.
    const circuitKey = this.accountKey;
    const circuitCheck = globalCircuitBreaker.canExecute(circuitKey);
    if (!circuitCheck.allowed) {
      throw new CircuitOpenError(circuitKey, circuitCheck.waitMs ?? 0);
    }

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

    const endpointClass = url.pathname.split('/').slice(0, 4).join('/');
    let latestQuotaStatus: QuotaStatus | null = null;

    const fetchFn = () => requestWithRetry(url.toString(), {
      method,
      headers,
      body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
    }, {
      accountKey: circuitKey,
      endpointClass,
      onAttempt: async () => {
        const rateBackoff = globalRateLimitTracker.shouldBackoff(circuitKey, endpointClass);
        if (rateBackoff.backoff) await sleep(rateBackoff.waitMs);

        const quotaStatus = await globalQuotaTracker.reserveAsync(circuitKey);
        latestQuotaStatus = quotaStatus;
        if (quotaStatus.allowed === false) {
          throw new AsaasQuotaExceededError(quotaStatus.retryAfterMs ?? 0);
        }
      },
      onResponse: (response) => {
        const info = extractRateLimitHeaders(response.headers);
        globalRateLimitTracker.update(circuitKey, endpointClass, info);
      },
    });

    // Semáforo de concorrência para GETs (Asaas limita a 50 concorrentes)
    let retryResult: RetryResult;
    try {
      retryResult = method === 'GET'
        ? await globalGetLimiter.run(circuitKey, fetchFn)
        : await fetchFn();
    } catch (error) {
      if (error instanceof AsaasQuotaExceededError || error instanceof AsaasConcurrencyLimitError) {
        globalAsaasHooks.emitApiCall({
          method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
          endpoint: url.pathname,
          accountKey: circuitKey,
          accountScope: this.accountScope,
          httpStatus: error.status,
          durationMs: Date.now() - startedAt,
          success: false,
          error: error.code,
          quotaRemaining: 0,
        });
      }
      throw error;
    }

    const { response, attempts, backoffMs } = retryResult;
    const rateLimitInfo = extractRateLimitHeaders(response.headers);
    const quotaStatus = latestQuotaStatus ?? globalQuotaTracker.getStatus(circuitKey);

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
      const isExpectedError = (options?.expectedErrorStatuses ?? []).includes(response.status);

      if (!isExpectedError) {
        globalCircuitBreaker.recordFailure(circuitKey, response.status);

        if (isEmptyBody || response.status >= 400) {
          console.warn('[asaas.http] Resposta de erro', {
            method,
            path: url.pathname,
            status: response.status,
            statusText: response.statusText,
            contentType,
            emptyBody: isEmptyBody,
            requestBodyPreview: buildSafeRequestBodyPreview(body),
            idempotencyKey: options?.headers?.['Idempotency-Key'] ?? undefined,
          });
        }

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
          quotaRemaining: quotaStatus.remaining,
          accountScope: this.accountScope,
          attempts,
          retryCount: Math.max(0, attempts - 1),
          backoffMs,
        });
      } else {
        globalAsaasHooks.emitApiCall({
          method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
          endpoint: url.pathname,
          accountKey: circuitKey,
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
          success: true,
          circuitState: globalCircuitBreaker.getState(circuitKey),
          rateLimitRemaining: rateLimitInfo.remaining ?? undefined,
          quotaRemaining: quotaStatus.remaining,
          accountScope: this.accountScope,
          attempts,
          retryCount: Math.max(0, attempts - 1),
          backoffMs,
        });
      }

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
      quotaRemaining: quotaStatus.remaining,
      accountScope: this.accountScope,
      attempts,
      retryCount: Math.max(0, attempts - 1),
      backoffMs,
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

const SENSITIVE_BODY_KEYS = new Set([
  'access_token',
  'apikey',
  'api_key',
  'authorization',
  'ccv',
  'cvv',
  'number',
  'password',
  'token',
]);

function redactSensitiveBody(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveBody(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_BODY_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactSensitiveBody(item, seen),
    ]),
  );
}

function buildSafeRequestBodyPreview(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;

  try {
    return JSON.stringify(redactSensitiveBody(body)).slice(0, 500);
  } catch {
    return '[Unserializable request body]';
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

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function resolveRequestTimeoutMs(method?: string): number {
  const normalizedMethod = method?.toUpperCase() ?? 'GET';
  const fallback = normalizedMethod === 'GET' ? 10_000 : 20_000;
  const methodSpecific = intFromEnv(`ASAAS_HTTP_${normalizedMethod}_TIMEOUT_MS`, fallback);
  return Math.min(60_000, Math.max(1_000, intFromEnv('ASAAS_HTTP_TIMEOUT_MS', methodSpecific)));
}

function withTimeoutSignal(init: RequestInit, timeoutMs: number): RequestInit {
  if (
    typeof AbortSignal === 'undefined' ||
    typeof AbortSignal.timeout !== 'function'
  ) {
    return init;
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!init.signal) {
    return { ...init, signal: timeoutSignal };
  }

  if (typeof AbortSignal.any === 'function') {
    return { ...init, signal: AbortSignal.any([init.signal, timeoutSignal]) };
  }

  return init;
}

function isRetryableFetchFailure(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }

  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    const message = error.message.toLowerCase();
    return (
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'EAI_AGAIN' ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('fetch failed')
    );
  }

  return false;
}

interface RetryContext {
  accountKey: string;
  endpointClass: string;
  onAttempt: () => Promise<void>;
  onResponse: (response: Response) => void;
}

interface RetryResult {
  response: Response;
  attempts: number;
  backoffMs: number;
}

async function requestWithRetry(
  url: string,
  init: RequestInit,
  context: RetryContext,
): Promise<RetryResult> {
  const maxAttempts = 3;
  const baseDelaysMs = [200, 500, 1000];
  const timeoutMs = resolveRequestTimeoutMs(init.method);

  let lastResponse: Response | null = null;
  let totalBackoffMs = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await context.onAttempt();

    let response: Response;
    try {
      response = await fetch(url, withTimeoutSignal(init, timeoutMs));
    } catch (error) {
      if (!isRetryableFetchFailure(error) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = jitter(baseDelaysMs[attempt - 1] ?? 1000);
      totalBackoffMs += delayMs;
      await sleep(delayMs);
      continue;
    }
    lastResponse = response;
    context.onResponse(response);

    const status = response.status;
    const method = (init.method ?? 'GET').toUpperCase();
    const canRetryUnsafeMethod = method === 'GET' || hasIdempotencyKey(init.headers);
    // POST/PUT/DELETE só são repetidos quando o caller declarou idempotência.
    const shouldRetry = canRetryUnsafeMethod && (status === 408 || status === 429 || (status >= 500 && status <= 599));
    if (!shouldRetry) return { response, attempts: attempt, backoffMs: totalBackoffMs };

    if (attempt === maxAttempts) return { response, attempts: attempt, backoffMs: totalBackoffMs };

    const retryAfterHeader = response.headers?.get?.('retry-after') ?? null;
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    const trackedBackoff = globalRateLimitTracker.shouldBackoff(context.accountKey, context.endpointClass);
    const retryDelay = retryAfterMs ?? 0;
    const rateLimitDelay = trackedBackoff.backoff ? trackedBackoff.waitMs : 0;
    const delayMs = Math.max(retryDelay, rateLimitDelay) || jitter(baseDelaysMs[attempt - 1] ?? 1000);
    totalBackoffMs += delayMs;
    await sleep(delayMs);
  }

  // fallback (nunca deve acontecer)
  return { response: lastResponse as Response, attempts: maxAttempts, backoffMs: totalBackoffMs };
}

function hasIdempotencyKey(headers: HeadersInit | undefined): boolean {
  if (!headers) return false;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Boolean(headers.get('Idempotency-Key'));
  }
  if (Array.isArray(headers)) {
    return headers.some(([name, value]) => name.toLowerCase() === 'idempotency-key' && Boolean(value));
  }
  return Object.entries(headers as Record<string, string>)
    .some(([name, value]) => name.toLowerCase() === 'idempotency-key' && Boolean(value));
}
