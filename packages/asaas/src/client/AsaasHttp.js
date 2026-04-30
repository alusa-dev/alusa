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
import { getAsaasBaseUrlFromEnvOrThrow } from './asaasBaseUrl';
export class AsaasHttpError extends Error {
    status;
    response;
    responseBody;
    constructor(message, status, response, responseBody) {
        super(message);
        this.status = status;
        this.response = response;
        this.responseBody = responseBody;
        this.name = 'AsaasHttpError';
    }
}
// Base URL validada/normalizada via helper central.
export class AsaasHttp {
    baseUrl;
    apiKey;
    constructor(config) {
        this.apiKey = config.apiKey;
        // Base URL deve ser fornecida via env para evitar divergências entre ambientes.
        this.baseUrl = getAsaasBaseUrlFromEnvOrThrow();
    }
    async get(path, options) {
        return this.request('GET', path, undefined, options);
    }
    async post(path, body, options) {
        return this.request('POST', path, body, options);
    }
    async put(path, body, options) {
        return this.request('PUT', path, body, options);
    }
    async delete(path, options) {
        return this.request('DELETE', path, undefined, options);
    }
    async request(method, path, body, options) {
        const startedAt = Date.now();
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
        const headers = {
            'access_token': this.apiKey,
            'User-Agent': 'Alusa/1.0',
            'Accept': 'application/json',
            ...options?.headers,
        };
        // Content-Type apenas quando temos body JSON (não FormData)
        if (!isFormData && body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        const response = await requestWithRetry(url.toString(), {
            method,
            headers,
            body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
        });
        if (process.env.ASAAS_HTTP_LOG === 'true') {
            const elapsedMs = Date.now() - startedAt;
            // Nunca logar apiKey/access_token.
            console.info('[asaas.http]', {
                method,
                path: url.pathname,
                status: response.status,
                elapsedMs,
            });
        }
        const contentType = response.headers.get('content-type') ?? '';
        let data = null;
        let rawText = '';
        try {
            rawText = await response.text();
        }
        catch {
            rawText = '';
        }
        const isEmptyBody = rawText.length === 0;
        if (rawText.length > 0) {
            if (contentType.includes('application/json')) {
                try {
                    data = JSON.parse(rawText);
                }
                catch {
                    data = rawText;
                }
            }
            else {
                data = rawText;
            }
        }
        else {
            // Body vazio - criar objeto diagnóstico
            data = {
                _emptyBody: true,
                statusText: response.statusText || 'Empty response',
                contentType,
            };
        }
        if (!response.ok) {
            // Log diagnóstico para erros com body vazio (provável problema de infra)
            if (isEmptyBody) {
                console.warn('[asaas.http] Resposta de erro com body vazio', {
                    method,
                    path: url.pathname,
                    status: response.status,
                    statusText: response.statusText,
                    contentType,
                });
            }
            const errorMessage = this.extractErrorMessage(data);
            throw new AsaasHttpError(errorMessage || `Asaas API error: ${response.status}`, response.status, data, data);
        }
        return data;
    }
    extractErrorMessage(data) {
        if (!data || typeof data !== 'object')
            return null;
        const obj = data;
        // Formato padrão Asaas: { errors: [{ description: "..." }] }
        if (Array.isArray(obj.errors) && obj.errors.length > 0) {
            const firstError = obj.errors[0];
            if (typeof firstError === 'object' && firstError && 'description' in firstError) {
                return String(firstError.description);
            }
        }
        // Fallback: message ou error
        if (typeof obj.message === 'string')
            return obj.message;
        if (typeof obj.error === 'string')
            return obj.error;
        return null;
    }
}
function parseRetryAfterMs(value) {
    if (!value)
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    // Pode ser delta-seconds
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0)
        return Math.round(seconds * 1000);
    // Ou HTTP-date
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
        const delta = dateMs - Date.now();
        return delta > 0 ? delta : 0;
    }
    return null;
}
function jitter(ms) {
    // jitter simples: +/- 20%
    const variance = ms * 0.2;
    const delta = (Math.random() * 2 - 1) * variance;
    return Math.max(0, Math.round(ms + delta));
}
async function sleep(ms) {
    if (ms <= 0)
        return;
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function requestWithRetry(url, init) {
    const maxAttempts = 3;
    const baseDelaysMs = [200, 500, 1000];
    let lastResponse = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await fetch(url, init);
        lastResponse = response;
        const status = response.status;
        const shouldRetry = status === 429 || (status >= 500 && status <= 599);
        if (!shouldRetry)
            return response;
        if (attempt === maxAttempts)
            return response;
        const retryAfterHeader = response.headers?.get?.('retry-after') ?? null;
        const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
        const delayMs = retryAfterMs ?? jitter(baseDelaysMs[attempt - 1] ?? 1000);
        await sleep(delayMs);
    }
    // fallback (nunca deve acontecer)
    return lastResponse;
}
