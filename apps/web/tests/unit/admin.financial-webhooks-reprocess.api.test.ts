/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  processAsaasWebhookQueue: vi.fn(),
  syncPaymentStateFromAsaas: vi.fn(),
}));

const {
  mockEmitBillingNotificationCandidate,
  mockEmitBillingNotifications,
} = vi.hoisted(() => ({
  mockEmitBillingNotificationCandidate: vi.fn(),
  mockEmitBillingNotifications: vi.fn(),
}));

vi.mock('@/lib/notifications/emit-billing-notifications', () => ({
  emitBillingNotificationCandidate: mockEmitBillingNotificationCandidate,
  emitBillingNotifications: mockEmitBillingNotifications,
}));

import { getServerSession } from 'next-auth';
import { processAsaasWebhookQueue, syncPaymentStateFromAsaas } from '@alusa/finance';
import { POST } from '@/app/api/admin/financial/webhooks/reprocess/route';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/financial/webhooks/reprocess', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/financial/webhooks/reprocess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await POST(request({}));
    expect(res.status).toBe(401);
  });

  it('retorna 403 quando sem permissão', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'PROFESSOR' },
    } as never);

    const res = await POST(request({}));
    expect(res.status).toBe(403);
  });

  it('reprocessa fila em modo queue por padrão', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);
    vi.mocked(processAsaasWebhookQueue).mockResolvedValue({
      processedPayments: [],
      processed: 1,
    } as never);

    const res = await POST(request({ limit: 20 }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ ok: true, mode: 'queue' });
    expect(processAsaasWebhookQueue).toHaveBeenCalledWith({
      contaId: 'c1',
      limit: 20,
      statuses: ['ERRO'],
      source: 'REPROCESS',
    });
    expect(mockEmitBillingNotifications).toHaveBeenCalled();
  });

  it('reconcilia pagamento específico quando asaasPaymentId é informado', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValue({
      success: true,
      paymentStatus: 'CONFIRMED',
      appliedEvent: 'PAYMENT_CONFIRMED',
    } as never);

    const res = await POST(request({ asaasPaymentId: 'pay_1', eventName: 'PAYMENT_CONFIRMED' }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ ok: true, mode: 'payment' });
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'c1',
      asaasPaymentId: 'pay_1',
      eventName: 'PAYMENT_CONFIRMED',
    });
    expect(mockEmitBillingNotificationCandidate).toHaveBeenCalledWith(
      {
        event: 'PAYMENT_CONFIRMED',
        asaasPaymentId: 'pay_1',
      },
      'ASAAS_SYNC',
    );
  });

  it('retorna 422 quando a reconciliação pontual falha', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValue({
      success: false,
      error: 'SYNC_FAILED',
    } as never);

    const res = await POST(request({ asaasPaymentId: 'pay_1' }));
    expect(res.status).toBe(422);
  });
});
