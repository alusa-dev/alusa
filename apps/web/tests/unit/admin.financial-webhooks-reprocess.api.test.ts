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
  processAsaasWebhookQueueWithInbox: vi.fn(),
  recordFinanceAdminAction: vi.fn(),
  syncPaymentStateFromAsaas: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { processAsaasWebhookQueueWithInbox, recordFinanceAdminAction, syncPaymentStateFromAsaas } from '@alusa/finance';
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
    vi.mocked(processAsaasWebhookQueueWithInbox).mockResolvedValue({
      processedPayments: [],
      processed: 1,
    } as never);

    const res = await POST(request({ limit: 20, reason: 'reprocessar webhook com erro' }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ ok: true, mode: 'queue' });
    expect(recordFinanceAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'c1',
        action: 'finance.webhooks.reprocess_queue.manual',
        reason: 'reprocessar webhook com erro',
      }),
    );
    expect(processAsaasWebhookQueueWithInbox).toHaveBeenCalledWith({
      contaId: 'c1',
      limit: 20,
      statuses: ['ERRO'],
      source: 'REPROCESS',
    });
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

    const res = await POST(request({
      asaasPaymentId: 'pay_1',
      eventName: 'PAYMENT_CONFIRMED',
      reason: 'reconciliar pagamento manualmente',
    }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ ok: true, mode: 'payment' });
    expect(recordFinanceAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'c1',
        action: 'finance.webhooks.reconcile_payment.manual',
        entity: { type: 'Payment', id: 'pay_1' },
        reason: 'reconciliar pagamento manualmente',
      }),
    );
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'c1',
      asaasPaymentId: 'pay_1',
      eventName: 'PAYMENT_CONFIRMED',
    });
  });

  it('retorna 422 quando a reconciliação pontual falha', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValue({
      success: false,
      error: 'SYNC_FAILED',
    } as never);

    const res = await POST(request({ asaasPaymentId: 'pay_1', reason: 'reconciliar pagamento manualmente' }));
    expect(res.status).toBe(422);
  });

  it('exige justificativa auditável para ação manual', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);

    const res = await POST(request({ limit: 20 }));
    expect(res.status).toBe(400);
    expect(processAsaasWebhookQueueWithInbox).not.toHaveBeenCalled();
    expect(syncPaymentStateFromAsaas).not.toHaveBeenCalled();
  });
});
