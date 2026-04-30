import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AsaasHttp } from './AsaasHttp';

process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';

function mockFetchOnce(status: number, body: unknown, headers?: Record<string, string>) {
  const response = {
    ok: status >= 200 && status <= 299,
    status,
    headers: {
      get: (name: string) => {
        const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? (headers as Record<string, string>)[key] : null;
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

  it('gera Idempotency-Key determinístico quando ausente (POST)', async () => {
    const client = new AsaasHttp({ apiKey: 'k' });

    mockFetchOnce(200, { ok: true });
    await client.post('/payments', { a: 1, b: { c: 2 } }, { idempotency: { contaId: 'c1', scope: 'create_payment' } });

    const firstCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const firstInit = firstCall?.[1] as RequestInit;
    const firstHeaders = (firstInit.headers ?? {}) as Record<string, string>;
    const firstKey = firstHeaders['Idempotency-Key'];

    expect(typeof firstKey).toBe('string');
    expect(firstKey).toMatch(/^alusa_[a-f0-9]{32}$/);

    vi.mocked(globalThis.fetch).mockClear();
    mockFetchOnce(200, { ok: true });

    await client.post('/payments', { b: { c: 2 }, a: 1 }, { idempotency: { contaId: 'c1', scope: 'create_payment' } });

    const secondInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    const secondHeaders = (secondInit.headers ?? {}) as Record<string, string>;
    expect(secondHeaders['Idempotency-Key']).toBe(firstKey);
  });

  it('não sobrescreve Idempotency-Key quando fornecida externamente', async () => {
    const client = new AsaasHttp({ apiKey: 'k' });

    mockFetchOnce(200, { ok: true });

    await client.post(
      '/payments',
      { a: 1 },
      {
        headers: { 'Idempotency-Key': 'external-123' },
        idempotency: { contaId: 'c1', scope: 'create_payment' },
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
});
