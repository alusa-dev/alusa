import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsaasHttpError } from '@alusa/asaas';
import { refundPaymentWithGateway as refundPayment } from '../refund-payment-adapter';

const original = {
  enabled: process.env.ASAAS_REFUND_GATEWAY_ENABLED,
  url: process.env.ASAAS_REFUND_GATEWAY_URL,
  secret: process.env.ASAAS_REFUND_GATEWAY_SECRET,
  fetch: globalThis.fetch,
};

afterEach(() => {
  if (original.enabled === undefined) delete process.env.ASAAS_REFUND_GATEWAY_ENABLED; else process.env.ASAAS_REFUND_GATEWAY_ENABLED = original.enabled;
  if (original.url === undefined) delete process.env.ASAAS_REFUND_GATEWAY_URL; else process.env.ASAAS_REFUND_GATEWAY_URL = original.url;
  if (original.secret === undefined) delete process.env.ASAAS_REFUND_GATEWAY_SECRET; else process.env.ASAAS_REFUND_GATEWAY_SECRET = original.secret;
  globalThis.fetch = original.fetch;
  vi.restoreAllMocks();
});

describe('finance refund gateway adapter', () => {
  it('fails closed when enabled without gateway configuration', async () => {
    process.env.ASAAS_REFUND_GATEWAY_ENABLED = 'true';
    delete process.env.ASAAS_REFUND_GATEWAY_URL;
    delete process.env.ASAAS_REFUND_GATEWAY_SECRET;
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    const error = await refundPayment({ apiKey: '$aact_hmlg_test', paymentId: 'pay_123' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AsaasHttpError);
    expect(error).toMatchObject({ status: 400, responseBody: { error: 'REFUND_GATEWAY_CONFIG_MISSING' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves sanitized gateway HTTP status as AsaasHttpError', async () => {
    process.env.ASAAS_REFUND_GATEWAY_ENABLED = 'true';
    process.env.ASAAS_REFUND_GATEWAY_URL = 'https://gateway.example';
    process.env.ASAAS_REFUND_GATEWAY_SECRET = 'test-secret-with-32-byte-minimum!';
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"error":"upstream_refund_failed"}', { status: 422 }));
    globalThis.fetch = fetch;
    const error = await refundPayment({ apiKey: '$aact_hmlg_test', paymentId: 'pay_123', idempotencyKey: 'command-1' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AsaasHttpError);
    expect(error).toMatchObject({ status: 422, responseBody: { error: 'REFUND_GATEWAY_HTTP_422' } });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it.each([408, 500])('preserves ambiguous gateway HTTP %s as AsaasHttpError', async (status) => {
    process.env.ASAAS_REFUND_GATEWAY_ENABLED = 'true';
    process.env.ASAAS_REFUND_GATEWAY_URL = 'https://gateway.example';
    process.env.ASAAS_REFUND_GATEWAY_SECRET = 'test-secret-with-32-byte-minimum!';
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"error":"upstream_timeout"}', { status }));
    globalThis.fetch = fetch;
    const error = await refundPayment({ apiKey: '$aact_hmlg_test', paymentId: 'pay_123', idempotencyKey: 'command-1' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AsaasHttpError);
    expect(error).toMatchObject({ status, responseBody: { error: `REFUND_GATEWAY_HTTP_${status}` } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it('requires the gateway URL to be an HTTPS origin only', async () => {
    process.env.ASAAS_REFUND_GATEWAY_ENABLED = 'true';
    process.env.ASAAS_REFUND_GATEWAY_URL = 'https://gateway.example/unexpected';
    process.env.ASAAS_REFUND_GATEWAY_SECRET = 'test-secret-with-32-byte-minimum!';
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    const error = await refundPayment({ apiKey: '$aact_hmlg_test', paymentId: 'pay_123', idempotencyKey: 'command-1' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AsaasHttpError);
    expect(error).toMatchObject({ status: 400, responseBody: { error: 'REFUND_GATEWAY_URL_INVALID' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('classifies a short gateway secret as terminal configuration failure before fetch', async () => {
    process.env.ASAAS_REFUND_GATEWAY_ENABLED = 'true';
    process.env.ASAAS_REFUND_GATEWAY_URL = 'https://gateway.example';
    process.env.ASAAS_REFUND_GATEWAY_SECRET = 'short';
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    const error = await refundPayment({ apiKey: '$aact_hmlg_test', paymentId: 'pay_123', idempotencyKey: 'command-1' }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AsaasHttpError);
    expect(error).toMatchObject({ status: 400, responseBody: { error: 'REFUND_GATEWAY_SECRET_INVALID' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a stable command key and derives the same request ID on retry', async () => {
    process.env.ASAAS_REFUND_GATEWAY_ENABLED = 'true';
    process.env.ASAAS_REFUND_GATEWAY_URL = 'https://gateway.example';
    process.env.ASAAS_REFUND_GATEWAY_SECRET = 'test-secret-with-32-byte-minimum!';
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"id":"pay_123"}', { status: 200 }));
    globalThis.fetch = fetch;
    await expect(refundPayment({ apiKey: '$aact_hmlg_test', paymentId: 'pay_123' })).rejects.toThrow(/chave de idempotência/);
    await refundPayment({ apiKey: '$aact_hmlg_test', paymentId: 'pay_123', idempotencyKey: 'command-stable-1' });
    await refundPayment({ apiKey: '$aact_hmlg_test', paymentId: 'pay_123', idempotencyKey: 'command-stable-1' });
    const firstId = fetch.mock.calls[0]?.[1]?.headers && new Headers(fetch.mock.calls[0][1]?.headers).get('x-alusa-request-id');
    const secondId = fetch.mock.calls[1]?.[1]?.headers && new Headers(fetch.mock.calls[1][1]?.headers).get('x-alusa-request-id');
    expect(firstId).toBeTruthy();
    expect(firstId).toBe(secondId);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
