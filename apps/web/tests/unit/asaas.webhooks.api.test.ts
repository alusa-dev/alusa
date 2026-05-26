/**
 * Testes unitários para Webhook do Asaas (rota fina)
 *
 * @vitest-environment node
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/webhooks/asaas/route';

vi.mock('@alusa/finance', () => ({
  handleAsaasWebhookEvent: vi.fn(),
  enqueueAsaasWebhookEvent: vi.fn(),
  inspectWebhookProcessingRuntimeStatus: vi.fn(() => ({
    mode: 'SYNC',
    useAsyncQueue: false,
    inlineDrain: true,
    isProduction: false,
    warnings: [],
  })),
  processAsaasWebhookQueue: vi.fn(),
  resolveAsaasWebhookAccessToken: vi.fn((headers: Pick<Headers, 'get'>) =>
    headers.get('asaas-access-token') ?? headers.get('x-asaas-access-token')
  ),
  getAsaasWebhookTokenHashPrefix: vi.fn(() => 'hashprefix'),
  extractClientIp: vi.fn(() => '127.0.0.1'),
  extractClientIps: vi.fn(() => ['127.0.0.1']),
  isAsaasWebhookIpAllowed: vi.fn(() => true),
  shouldBlockAsaasWebhookByIp: vi.fn(() => false),
  buildWebhookRateLimitKey: vi.fn(({ ip }) => `ip:${ip ?? 'unknown'}`),
  redactWebhookLogObject: vi.fn((value) => value),
  globalWebhookRateLimiter: {
    check: vi.fn(() => ({ allowed: true, resetMs: 0 })),
  },
}));

const { mockEmitBillingNotificationCandidate } = vi.hoisted(() => ({
  mockEmitBillingNotificationCandidate: vi.fn(),
}));

vi.mock('../../lib/notifications/emit-billing-notifications', () => ({
  emitBillingNotificationCandidate: mockEmitBillingNotificationCandidate,
  emitBillingNotifications: vi.fn(),
}));

const { handleAsaasWebhookEvent, globalWebhookRateLimiter } = await import('@alusa/finance');

describe('POST /api/webhooks/asaas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS;
  });

  function createRequest(params: {
    body: unknown;
    signatureHeader?: { name: string; value: string };
  }): NextRequest {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (params.signatureHeader) {
      headers.set(params.signatureHeader.name, params.signatureHeader.value);
    }

    const url = new URL('http://localhost:3001/api/webhooks/asaas');

    return new NextRequest(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(params.body),
    });
  }

  it('normaliza erro do handler do finance para 200 e mantém payload de erro', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: false,
      status: 403,
      persisted: false,
      error: 'Assinatura inválida',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'bad' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: 'Assinatura inválida' });
  });

  it('mantém rejeições persistidas como 200 por padrão quando strict está desligado', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: false,
      status: 401,
      persisted: false,
      error: 'Assinatura inválida',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('retorna 401 para token ausente quando strict está ligado', async () => {
    process.env.ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS = 'true';
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: false,
      status: 401,
      persisted: false,
      error: 'Assinatura inválida',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('retorna 403 para token inválido quando strict está ligado', async () => {
    process.env.ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS = 'true';
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: false,
      status: 403,
      persisted: false,
      error: 'Assinatura inválida',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'bad-token-with-valid-length' },
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('normaliza ausência de token para 200', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: false,
      status: 401,
      persisted: false,
      error: 'Assinatura inválida',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ success: false, error: 'Assinatura inválida' });

    expect(vi.mocked(handleAsaasWebhookEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: null }),
    );
  });

  it('retorna status do handler do finance (200)', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: true,
      status: 200,
      persisted: true,
      message: 'ok',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'token' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ success: true, message: 'ok' });
  });

  it('aceita header alternativo x-asaas-access-token', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: true,
      status: 200,
      persisted: true,
      message: 'ok',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'x-asaas-access-token', value: 'token-alt' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(vi.mocked(handleAsaasWebhookEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token-alt' }),
    );
  });

  it('não registra token bruto quando aplica rate limit', async () => {
    vi.mocked(globalWebhookRateLimiter.check).mockReturnValueOnce({ allowed: false, remaining: 0, resetMs: 1000 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'raw-token-with-enough-length' },
    });

    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('raw-token-with-enough-length');
    warnSpy.mockRestore();
  });

  it('mantém sucesso quando a emissão de notificação falha após o processamento', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: true,
      status: 200,
      persisted: true,
      message: 'ok',
    });
    mockEmitBillingNotificationCandidate.mockRejectedValueOnce(new Error('notify failed'));

    const req = createRequest({
      body: {
        id: 'evt_1',
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_123', clientPaymentDate: '2026-03-27' },
      },
      signatureHeader: { name: 'asaas-access-token', value: 'token' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ success: true, message: 'ok' });
  });

  it('retorna 500 quando há falha técnica antes de persistir o webhook', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: false,
      status: 500,
      persisted: false,
      error: 'Falha ao persistir webhook',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'valid-token-with-enough-length' },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('retorna 200 quando o evento foi persistido e o processamento falhou', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: false,
      status: 500,
      persisted: true,
      webhookId: 'wh_local_1',
      error: 'handler failed',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'valid-token-with-enough-length' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ success: false, persisted: true, error: 'handler failed' });
  });
});
