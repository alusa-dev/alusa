import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AsaasHttp } from './AsaasHttp';
import { getAsaasBaseUrlForApiKeyOrThrow } from './asaasBaseUrl.ts';

process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';

function mockFetchOnce(status: number, body: unknown, headers?: Record<string, string>) {
  const mergedHeaders = { 'content-type': 'application/json', ...(headers ?? {}) };
  const response = {
    ok: status >= 200 && status <= 299,
    status,
    headers: {
      get: (name: string) => {
        const key = Object.keys(mergedHeaders).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? mergedHeaders[key as keyof typeof mergedHeaders] : null;
      },
    },
    text: vi.fn(async () => (body === undefined ? '' : JSON.stringify(body))),
  } as unknown as Response;

  vi.mocked(globalThis.fetch).mockResolvedValueOnce(response);
}

describe('AsaasHttp (idempotência + retry)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mantem Idempotency-Key quando fornecida externamente', async () => {
    const client = new AsaasHttp({ apiKey: 'k' });

    mockFetchOnce(200, { ok: true });

    await client.post(
      '/payments',
      { a: 1 },
      {
        headers: { 'Idempotency-Key': 'external-123' },
      },
    );

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;

    expect(headers['Idempotency-Key']).toBe('external-123');
  });

  it('faz retry em 429 e depois retorna sucesso', async () => {
    vi.useFakeTimers();

    const client = new AsaasHttp({ apiKey: 'k' });

    mockFetchOnce(429, { error: 'rate_limit' }, { 'Retry-After': '0' });
    mockFetchOnce(200, { ok: true });

    const promise = client.get('/balance');

    // libera o sleep (Retry-After: 0)
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it('não faz retry em erro 400', async () => {
    const client = new AsaasHttp({ apiKey: 'k' });

    mockFetchOnce(400, { message: 'bad request' });

    await expect(client.get('/balance')).rejects.toMatchObject({ name: 'AsaasHttpError', status: 400 });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it('faz retry em 500 e depois retorna sucesso', async () => {
    vi.useFakeTimers();

    const client = new AsaasHttp({ apiKey: 'k' });

    mockFetchOnce(500, { error: 'server_error' }, { 'Retry-After': '0' });
    mockFetchOnce(200, { ok: true });

    const promise = client.get('/balance');
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });

  it('resolve endpoint oficial de producao quando a api key eh prod mesmo com env sandbox', () => {
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';

    expect(getAsaasBaseUrlForApiKeyOrThrow('$aact_prod_exemplo')).toBe('https://api.asaas.com/v3/');
  });

  it('resolve endpoint oficial de sandbox quando a api key eh hmlg mesmo com env producao', () => {
    process.env.ASAAS_BASE_URL = 'https://api.asaas.com/v3';

    expect(getAsaasBaseUrlForApiKeyOrThrow('$aact_hmlg_exemplo')).toBe('https://api-sandbox.asaas.com/v3/');
  });
});
