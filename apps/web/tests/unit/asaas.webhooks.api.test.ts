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
  extractClientIps: vi.fn(() => ['127.0.0.1']),
  isAsaasWebhookIpAllowed: vi.fn(() => true),
  shouldBlockAsaasWebhookByIp: vi.fn(() => false),
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

const { handleAsaasWebhookEvent } = await import('@alusa/finance');

describe('POST /api/webhooks/asaas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('normaliza ausência de token para 200', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: false,
      status: 401,
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

  it('mantém sucesso quando a emissão de notificação falha após o processamento', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockResolvedValue({
      success: true,
      status: 200,
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

  it('não expõe detalhe de configuração quando o segredo do webhook está ausente', async () => {
    vi.mocked(handleAsaasWebhookEvent).mockRejectedValueOnce(
      new Error('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET não configurado'),
    );

    const req = createRequest({
      body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_123' } },
      signatureHeader: { name: 'asaas-access-token', value: 'token' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({
      success: false,
      error: 'ENV_NOT_CONFIGURED',
      message: 'Configuração obrigatória do webhook indisponível.',
    });
    expect(JSON.stringify(json)).not.toContain('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET');
  });
});
