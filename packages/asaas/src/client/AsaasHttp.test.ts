import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AsaasApiKeyError, AsaasHttp } from './AsaasHttp';
import { globalAsaasHooks } from './asaas-hooks';
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  it('recusa API key com caracteres Unicode antes de montar o header HTTP', () => {
    expect(() => new AsaasHttp({ apiKey: `${'k'.repeat(565)}✓` })).toThrow(AsaasApiKeyError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('recusa API key com caracteres de controle antes de montar o header HTTP', () => {
    expect(() => new AsaasHttp({ apiKey: 'valid-\nkey' })).toThrow(AsaasApiKeyError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('não chama o Asaas em produção quando o Redis de quota está ausente', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ASAAS_REDIS_ENABLED', 'false');
    const hookSpy = vi.spyOn(globalAsaasHooks, 'emitApiCall');
    const client = new AsaasHttp({ apiKey: 'k' });

    await expect(client.post('/payments', { value: 10 })).rejects.toMatchObject({
      name: 'AsaasQuotaStoreUnavailableError',
      code: 'ASAAS_QUOTA_STORE_UNAVAILABLE',
      status: 503,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(hookSpy).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      httpStatus: 503,
      success: false,
      error: 'ASAAS_QUOTA_STORE_UNAVAILABLE',
    }));
  });

  it('não inicia GET em produção quando o semáforo distribuído está ausente', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ASAAS_REDIS_ENABLED', 'false');
    const client = new AsaasHttp({ apiKey: 'k' });

    await expect(client.get('/balance')).rejects.toMatchObject({
      name: 'AsaasConcurrencyStoreUnavailableError',
      code: 'ASAAS_GET_CONCURRENCY_STORE_UNAVAILABLE',
      status: 503,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
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

  it('não repete mutação em 429 sem Idempotency-Key', async () => {
    const client = new AsaasHttp({ apiKey: 'k' });

    mockFetchOnce(429, { error: 'rate_limit' }, { 'Retry-After': '0' });

    await expect(client.post('/payments', { value: 10 })).rejects.toMatchObject({
      name: 'AsaasHttpError',
      status: 429,
    });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  it('registra apenas campos operacionais allowlisted em falha do provedor', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new AsaasHttp({ apiKey: 'k' });

    mockFetchOnce(400, { message: 'payment refused' });

    await expect(
      client.post('/payments/pay_1/payWithCreditCard', {
        creditCard: { number: '4444444444444444', ccv: '123', holderName: 'Test Holder' },
        creditCardHolderInfo: { name: 'Test Holder' },
      }, { headers: { 'Idempotency-Key': 'idempotency-secret' } }),
    ).rejects.toMatchObject({ status: 400 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(warnSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record['event.name']).toBe('asaas.http.request.failed');
    expect(record['http.request.method']).toBe('post');
    expect(record['http.route']).toBe('/v3/payments');
    expect(record['http.response.status_code']).toBe(400);
    expect(record['error.type']).toBe('AsaasHttpError');
    expect(typeof record.duration_ms).toBe('number');
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('pay_1');
    expect(serialized).not.toContain('4444444444444444');
    expect(serialized).not.toContain('"ccv":"123"');
    expect(serialized).not.toContain('idempotency-secret');
    expect(serialized).not.toContain('payment refused');
  });

  it('remove authToken e credenciais aninhadas do log de falha do provedor', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new AsaasHttp({ apiKey: 'k' });
    const authToken = 'webhook-secret-that-must-never-reach-logs';
    const accessToken = 'access-token-that-must-never-reach-logs';

    mockFetchOnce(400, { errors: [{ code: 'invalid_webhook', description: 'Webhook inválido' }] });

    await expect(
      client.put('/webhooks/wh_1', {
        authToken,
        nested: { AUTH_TOKEN: authToken, access_token: accessToken },
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(warnSpy.mock.calls);
    expect(serialized).not.toContain(authToken);
    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain('wh_1');
    expect(serialized).not.toContain('Webhook inválido');
  });

  it('404 esperado não emite log de erro e fica marcado como estado esperado no hook', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hookSpy = vi.spyOn(globalAsaasHooks, 'emitApiCall');

    const client = new AsaasHttp({ apiKey: 'k' });
    mockFetchOnce(404, { message: 'not found' });

    await expect(
      client.get('/subscriptions/sub_123/invoiceSettings', { expectedErrorStatuses: [404] }),
    ).rejects.toMatchObject({ name: 'AsaasHttpError', status: 404 });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(hookSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        httpStatus: 404,
        success: true,
        expectedError: true,
        error: 'EXPECTED_HTTP_404',
      }),
    );

    warnSpy.mockRestore();
    hookSpy.mockRestore();
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
