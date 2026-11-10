import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRefundRequest, signRefundRequest, validateGatewaySecret } from './refund-gateway';

const secret = 'test-secret-must-be-at-least-32-bytes';
let server: ReturnType<typeof createServer> | undefined;
let nonceDirectory: string;
afterEach(async () => { server?.close(); server = undefined; if (nonceDirectory) await rm(nonceDirectory, { recursive: true, force: true }); nonceDirectory = ''; vi.restoreAllMocks(); });

async function request(body: unknown, path = '/v1/payments/pay_123/refund', auth = true, fetchImpl = vi.fn(async () => new Response('{"id":"pay_123"}', { status: 200 })), requestId = randomUUID(), signedPath = path, bodyOverride?: string): Promise<{ response: Response; upstream: ReturnType<typeof vi.fn>; requestId: string }> {
  if (!nonceDirectory) nonceDirectory = await mkdtemp(join(tmpdir(), 'alusa-refund-nonces-'));
  server = createServer((req, res) => { void handleRefundRequest(req, res, { secret, nonceDirectory, now: () => 1_700_000_000_000, fetchImpl: fetchImpl as typeof fetch }); });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test server address');
  const raw = bodyOverride ?? JSON.stringify(body);
  const timestamp = '1700000000000';
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'x-alusa-timestamp': timestamp, 'x-alusa-request-id': requestId, 'x-alusa-signature': signRefundRequest(secret, 'POST', signedPath, timestamp, requestId, raw) } : {}) }, body: raw });
  return { response, upstream: fetchImpl, requestId };
}

describe('refund egress gateway', () => {
  it('requires valid request authentication', async () => {
    const { response, upstream } = await request({ apiKey: '$aact_hmlg_test' }, undefined, false);
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('binds the path in the signature and rejects replayed request IDs', async () => {
    const requestId = randomUUID();
    const first = await request({ apiKey: '$aact_hmlg_test' }, undefined, true, undefined, requestId);
    expect(first.response.status).toBe(200);
    const persistentDirectory = nonceDirectory;
    server?.close(); server = undefined;
    nonceDirectory = persistentDirectory;
    const retryUpstream = vi.fn();
    server = createServer((req, res) => { void handleRefundRequest(req, res, { secret, nonceDirectory, now: () => 1_700_000_000_000, fetchImpl: retryUpstream }); });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server address');
    const raw = JSON.stringify({ apiKey: '$aact_hmlg_test' });
    const timestamp = '1700000000000';
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/payments/pay_123/refund`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alusa-timestamp': timestamp, 'x-alusa-request-id': requestId, 'x-alusa-signature': signRefundRequest(secret, 'POST', '/v1/payments/pay_123/refund', timestamp, requestId, raw) }, body: raw });
    const replay = { response };
    expect(replay.response.status).toBe(503);
    expect(retryUpstream).not.toHaveBeenCalled();
    server?.close(); server = undefined;
    const mismatched = await request({ apiKey: '$aact_hmlg_test' }, '/v1/payments/pay_other/refund', true, undefined, randomUUID(), '/v1/payments/pay_123/refund');
    expect(mismatched.response.status).toBe(401);
  });
  it('allows only one concurrent dispatch for the same durable request ID', async () => {
    nonceDirectory = await mkdtemp(join(tmpdir(), 'alusa-refund-concurrent-'));
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"id":"pay_123"}', { status: 200 }));
    const handlers = Array.from({ length: 2 }, () => createServer((req, res) => {
      void handleRefundRequest(req, res, { secret, nonceDirectory, now: () => 1_700_000_000_000, fetchImpl: upstream });
    }));
    const addresses = await Promise.all(handlers.map(async (handler) => {
      await new Promise<void>((resolve) => handler.listen(0, '127.0.0.1', resolve));
      const address = handler.address();
      if (!address || typeof address === 'string') throw new Error('missing test server address');
      return address;
    }));
    const path = '/v1/payments/pay_123/refund';
    const raw = JSON.stringify({ apiKey: '$aact_hmlg_test' });
    const timestamp = '1700000000000';
    const requestId = randomUUID();
    const signature = signRefundRequest(secret, 'POST', path, timestamp, requestId, raw);
    try {
      const responses = await Promise.all(addresses.map((address) => fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-alusa-timestamp': timestamp, 'x-alusa-request-id': requestId, 'x-alusa-signature': signature },
        body: raw,
      })));
      expect(responses.map((response) => response.status).sort()).toEqual([200, 503]);
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      await Promise.all(handlers.map((handler) => new Promise<void>((resolve) => handler.close(() => resolve()))));
    }
  });
  it('pins host, path, method and forwards only refund payload', async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"id":"pay_123"}', { status: 200 }));
    const { response } = await request({ apiKey: '$aact_hmlg_test', value: 12, description: 'sandbox' }, undefined, true, upstream);
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith('https://api-sandbox.asaas.com/v3/payments/pay_123/refund', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ access_token: '$aact_hmlg_test' }), body: '{"value":12,"description":"sandbox"}' }));
    expect(upstream.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });
  it('rejects production keys and malformed path without upstream call', async () => {
    const upstream = vi.fn();
    const prod = await request({ apiKey: '$aact_prod_test' }, undefined, true, upstream);
    expect(prod.response.status).toBe(400);
    expect((await request({ apiKey: '$aact_hmlg_test' }, '/v1/payments/x/../refund', true, upstream)).response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not leak upstream errors and maps timeout safely', async () => {
    const fail = await request({ apiKey: '$aact_hmlg_test' }, undefined, true, vi.fn(async () => new Response('secret details', { status: 500 })));
    expect(await fail.response.json()).toEqual({ error: 'upstream_refund_failed' });
    const timeout = await request({ apiKey: '$aact_hmlg_test' }, undefined, true, vi.fn(async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; }));
    expect(timeout.response.status).toBe(504);
    expect(await timeout.response.json()).toEqual({ error: 'upstream_timeout' });
  });
  it('rejects non-object JSON and redirects without following upstream 30x', async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('', { status: 302, headers: { location: 'https://attacker.example' } }));
    const invalid = await request(null, undefined, true, upstream, randomUUID(), undefined, 'null');
    expect(invalid.response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    const redirect = await request({ apiKey: '$aact_hmlg_test' }, undefined, true, upstream);
    expect(redirect.response.status).toBe(302);
    expect(upstream.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });
  it('requires a 32-byte shared secret', () => {
    expect(() => validateGatewaySecret('short')).toThrow(/32 bytes/);
    expect(() => validateGatewaySecret(secret)).not.toThrow();
  });
});
