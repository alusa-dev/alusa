/**
 * Testes unitários para Webhook do Asaas (rota fina)
 *
 * @vitest-environment node
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { registerTelemetrySink, type StructuredLog, type TelemetryMetric } from '@alusa/observability';
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
  parseAsaasWebhookPayload: vi.fn((rawBody: string) => ({
    success: true,
    payload: JSON.parse(rawBody),
  })),
  resolveAsaasWebhookAccessToken: vi.fn((headers: Pick<Headers, 'get'>) =>
    headers.get('asaas-access-token')
  ),
  getAsaasWebhookTokenHashPrefix: vi.fn(() => 'hashprefix'),
  extractClientIp: vi.fn(() => '127.0.0.1'),
  extractClientIps: vi.fn(() => ['127.0.0.1']),
  isAsaasWebhookIpAllowed: vi.fn(() => true),
  shouldBlockAsaasWebhookByIp: vi.fn(() => false),
  buildWebhookRateLimitKey: vi.fn(({ ip }) => `ip:${ip ?? 'unknown'}`),
  isWebhookRateLimitFailClosedEnabled: vi.fn(() => false),
  redactWebhookLogObject: vi.fn((value) => value),
  globalWebhookRateLimiter: {
    check: vi.fn(() => ({ allowed: true, resetMs: 0 })),
    checkAsync: vi.fn(async () => ({ allowed: true, resetMs: 0, remaining: 199, backend: 'memory', degraded: false })),
  },
}));

const { mockEmitBillingNotificationCandidate } = vi.hoisted(() => ({
  mockEmitBillingNotificationCandidate: vi.fn(),
}));

vi.mock('../../lib/notifications/emit-billing-notifications', () => ({
  emitBillingNotificationCandidate: mockEmitBillingNotificationCandidate,
  emitBillingNotifications: vi.fn(),
}));

const {
  handleAsaasWebhookEvent,
  globalWebhookRateLimiter,
  isWebhookRateLimitFailClosedEnabled,
} = await import('@alusa/finance');

describe('POST /api/webhooks/asaas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS;
  });

  function createRequest(params: {
    body: unknown;
    signatureHeader?: { name: string; value: string };
    forwardedFor?: string;
  }): NextRequest {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (params.signatureHeader) {
      headers.set(params.signatureHeader.name, params.signatureHeader.value);
    }
    if (params.forwardedFor) headers.set('x-forwarded-for', params.forwardedFor);

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

  it('mantém requestId técnico separado do correlationId do evento', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: true,
      status: 200,
      persisted: true,
      message: 'ok',
    });

    const req = createRequest({
      body: { id: 'evt_123', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'token' },
    });
    req.headers.set('x-request-id', 'asaas-test-request-1');

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('asaas-test-request-1');
    expect(vi.mocked(handleAsaasWebhookEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'asaas-event:evt_123' }),
    );
    const call = vi.mocked(handleAsaasWebhookEvent).mock.calls[0]?.[0];
    expect(call?.correlationId).not.toBe('asaas-test-request-1');
  });

  it('aceita o header oficial asaas-access-token', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: true,
      status: 200,
      persisted: true,
      message: 'ok',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'token-official' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(vi.mocked(handleAsaasWebhookEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'token-official' }),
    );
  });

  it('passa somente o primeiro IP de x-forwarded-for ao handler financeiro', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: true,
      status: 200,
      persisted: true,
      message: 'ok',
    });

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      forwardedFor: '198.51.100.12, 52.67.211.226',
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(handleAsaasWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ clientIp: '198.51.100.12' }),
    );
  });

  it('não registra token bruto quando aplica rate limit', async () => {
    vi.mocked(globalWebhookRateLimiter.checkAsync).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetMs: 1000,
      backend: 'memory',
      degraded: false,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'raw-token-with-enough-length' },
    });

    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('raw-token-with-enough-length');
    warnSpy.mockRestore();
  });

  it('retorna 503 quando o rate limit distribuído está indisponível em modo fail-closed', async () => {
    vi.mocked(globalWebhookRateLimiter.checkAsync).mockResolvedValueOnce({
      allowed: true,
      remaining: 199,
      resetMs: 60_000,
      backend: 'memory',
      degraded: true,
    });
    vi.mocked(isWebhookRateLimitFailClosedEnabled).mockReturnValueOnce(true);

    const res = await POST(createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'token-official' },
    }));

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await res.json()).toMatchObject({ error: 'RATE_LIMIT_UNAVAILABLE' });
    expect(handleAsaasWebhookEvent).not.toHaveBeenCalled();
  });

  it('agrega métricas HTTP de rate limit sem logar token ou gravar no banco', async () => {
    const metrics: TelemetryMetric[] = [];
    const unsubscribe = registerTelemetrySink({ metric: (metric) => metrics.push(metric) });
    vi.mocked(globalWebhookRateLimiter.checkAsync).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetMs: 1000,
      backend: 'memory',
      degraded: false,
    });

    try {
      const res = await POST(createRequest({
        body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
        signatureHeader: { name: 'asaas-access-token', value: 'raw-token-with-enough-length' },
      }));

      expect(res.status).toBe(429);
      expect(metrics).toContainEqual(expect.objectContaining({
        kind: 'counter',
        name: 'alusa.http.server.requests',
        value: 1,
        dimensions: {
          'http.request.method': 'post',
          'http.route': '/api/webhooks/asaas',
          'http.response.status_class': '4xx',
        },
      }));
      expect(JSON.stringify(metrics)).not.toContain('raw-token-with-enough-length');
    } finally {
      unsubscribe();
    }
  });

  it('mantém sucesso quando a emissão de notificação falha após o processamento', async () => {
    const logs: StructuredLog[] = [];
    const unsubscribe = registerTelemetrySink({ log: (record) => logs.push(record) });
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: true,
      status: 200,
      persisted: true,
      message: 'ok',
      contaId: 'conta-private',
    });
    mockEmitBillingNotificationCandidate.mockRejectedValueOnce(
      new Error('notify failed for conta-private, payment-private'),
    );

    const req = createRequest({
      body: {
        id: 'evt_1',
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_123', clientPaymentDate: '2026-03-27' },
      },
      signatureHeader: { name: 'asaas-access-token', value: 'token' },
    });
    req.headers.set('x-request-id', 'webhook-request-123');

    try {
      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toMatchObject({ success: true, message: 'ok' });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        severity: 'warn',
        'event.name': 'api.webhook.notification_candidate.failed',
        requestId: 'webhook-request-123',
        'http.route': '/api/webhooks/asaas',
        'http.request.method': 'post',
        'error.type': 'Error',
      });
      expect(JSON.stringify(logs)).not.toContain('conta-private');
      expect(JSON.stringify(logs)).not.toContain('payment-private');
    } finally {
      unsubscribe();
    }
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
