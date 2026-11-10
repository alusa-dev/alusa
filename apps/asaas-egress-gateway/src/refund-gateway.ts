import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 16_384;
const TIMEOUT_MS = 15_000;
const UPSTREAM = 'https://api-sandbox.asaas.com/v3/payments/';
const PATH = /^\/v1\/payments\/([A-Za-z0-9_-]{1,80})\/refund$/;

export interface RefundGatewayConfig {
  secret: string;
  nonceDirectory: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function validateGatewaySecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('ASAAS_REFUND_GATEWAY_SECRET deve ter pelo menos 32 bytes.');
}

async function reserveRequestId(directory: string, requestId: string, now: number): Promise<'reserved' | 'replay'> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, requestId);
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(String(now)); await file.sync(); } finally { await file.close(); }
    const directoryHandle = await open(directory, 'r');
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return 'reserved';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'replay';
    throw error;
  }
}

export function signRefundRequest(secret: string, method: string, path: string, timestamp: string, requestId: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${method}.${path}.${timestamp}.${requestId}.${rawBody}`).digest('hex');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(encoded);
}

export async function handleRefundRequest(req: IncomingMessage, res: ServerResponse, config: RefundGatewayConfig): Promise<void> {
  try { validateGatewaySecret(config.secret); } catch { return send(res, 503, { error: 'gateway_not_configured' }); }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const match = PATH.exec(req.url ?? '');
  if (!match) return send(res, 404, { error: 'not_found' });
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(res, 415, { error: 'unsupported_media_type' });

  let rawBody = '';
  for await (const chunk of req) {
    rawBody += chunk.toString();
    if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return send(res, 413, { error: 'payload_too_large' });
  }
  const timestamp = req.headers['x-alusa-timestamp'];
  const signature = req.headers['x-alusa-signature'];
  const requestId = req.headers['x-alusa-request-id'];
  if (typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) || Math.abs((config.now?.() ?? Date.now()) - Number(timestamp)) > 60_000 || typeof signature !== 'string' || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    return send(res, 401, { error: 'unauthorized' });
  }
  const path = req.url ?? '';
  const expected = signRefundRequest(config.secret, 'POST', path, timestamp, requestId, rawBody);
  const expectedBytes = Buffer.from(expected, 'hex');
  const signatureBytes = Buffer.from(signature, 'hex');
  if (expectedBytes.length !== signatureBytes.length || !timingSafeEqual(expectedBytes, signatureBytes)) return send(res, 401, { error: 'unauthorized' });
  const now = config.now?.() ?? Date.now();
  let reservation: 'reserved' | 'replay';
  try { reservation = await reserveRequestId(config.nonceDirectory, requestId, now); } catch {
    return send(res, 503, { error: 'replay_store_unavailable' });
  }
  if (reservation === 'replay') return send(res, 503, { error: 'command_already_dispatched' });

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody) as Record<string, unknown>; } catch { return send(res, 400, { error: 'invalid_request' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'invalid_request' });
  const keys = Object.keys(body);
  if (keys.some((key) => !['apiKey', 'value', 'description', 'splitRefunds'].includes(key)) || typeof body.apiKey !== 'string' || !body.apiKey.startsWith('$aact_hmlg_')) return send(res, 400, { error: 'sandbox_key_required' });
  if (body.value !== undefined && (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value <= 0)) return send(res, 400, { error: 'invalid_request' });
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 500)) return send(res, 400, { error: 'invalid_request' });
  if (body.splitRefunds !== undefined && (!Array.isArray(body.splitRefunds) || body.splitRefunds.length > 20 || body.splitRefunds.some((item) => !item || typeof item !== 'object' || Object.keys(item).some((key) => !['id', 'value'].includes(key)) || typeof item.id !== 'string' || typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value <= 0))) return send(res, 400, { error: 'invalid_request' });

  const { apiKey, ...refundBody } = body;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await (config.fetchImpl ?? fetch)(`${UPSTREAM}${match[1]}/refund`, {
      method: 'POST', headers: { access_token: apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(refundBody), signal: controller.signal, redirect: 'error',
    });
    const text = await upstream.text();
    let result: unknown = null;
    try { result = text ? JSON.parse(text) : null; } catch { result = null; }
    // Provider detail may contain sensitive data. Return only status and safe payment resource.
    if (!upstream.ok) return send(res, upstream.status, { error: 'upstream_refund_failed' });
    return send(res, upstream.status, result);
  } catch (error) {
    return send(res, error instanceof Error && error.name === 'AbortError' ? 504 : 502, { error: error instanceof Error && error.name === 'AbortError' ? 'upstream_timeout' : 'upstream_unavailable' });
  } finally { clearTimeout(timeout); }
}
