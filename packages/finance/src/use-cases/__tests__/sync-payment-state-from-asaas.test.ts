import { describe, expect, it, vi, beforeEach } from 'vitest';

import { syncPaymentStateFromAsaas } from '../sync-payment-state-from-asaas';

vi.mock('../asaas-ops', () => ({
  isAsaasEnabled: vi.fn(() => true),
  getPayment: vi.fn(),
}));

vi.mock('../../webhooks/payment-webhook-handler', () => ({
  handlePaymentWebhook: vi.fn(),
}));

describe('syncPaymentStateFromAsaas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reaplica estado do Asaas via pipeline de webhook', async () => {
    const { getPayment } = await import('../asaas-ops');
    const { handlePaymentWebhook } = await import('../../webhooks/payment-webhook-handler');

    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_123',
      status: 'CONFIRMED',
      value: 120,
      netValue: 115,
      description: 'Mensalidade',
      billingType: 'BOLETO',
      dueDate: '2026-02-07',
      invoiceUrl: 'https://asaas.test/i/pay_123',
      bankSlipUrl: 'https://asaas.test/boleto/pay_123',
      transactionReceiptUrl: 'https://asaas.test/comprovante/pay_123',
      object: 'payment',
      dateCreated: '2026-02-07',
      customer: 'cus_1',
      originalDueDate: '2026-02-07',
      deleted: false,
    } as never);

    vi.mocked(handlePaymentWebhook).mockResolvedValueOnce({ success: true } as never);

    const result = await syncPaymentStateFromAsaas({
      contaId: 'conta_1',
      asaasPaymentId: 'pay_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.paymentStatus).toBe('CONFIRMED');
      expect(result.appliedEvent).toBe('PAYMENT_CONFIRMED');
    }

    expect(handlePaymentWebhook).toHaveBeenCalledWith(
      'conta_1',
      expect.objectContaining({
        event: 'PAYMENT_CONFIRMED',
        payment: expect.objectContaining({
          id: 'pay_123',
          status: 'CONFIRMED',
          value: 120,
          description: 'Mensalidade',
          invoiceUrl: 'https://asaas.test/i/pay_123',
          bankSlipUrl: 'https://asaas.test/boleto/pay_123',
          transactionReceiptUrl: 'https://asaas.test/comprovante/pay_123',
        }),
      })
    );
  });

  it('retorna erro quando o pipeline interno falha', async () => {
    const { getPayment } = await import('../asaas-ops');
    const { handlePaymentWebhook } = await import('../../webhooks/payment-webhook-handler');

    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_abc',
      status: 'PENDING',
      value: 99,
      netValue: 99,
      billingType: 'PIX',
      dueDate: '2026-02-07',
      object: 'payment',
      dateCreated: '2026-02-07',
      customer: 'cus_1',
      originalDueDate: '2026-02-07',
      deleted: false,
    } as never);

    vi.mocked(handlePaymentWebhook).mockResolvedValueOnce({
      success: false,
      error: 'webhook pipeline error',
    } as never);

    const result = await syncPaymentStateFromAsaas({
      contaId: 'conta_1',
      asaasPaymentId: 'pay_abc',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('webhook pipeline error');
    }
  });

  it('força PAYMENT_DELETED quando o Asaas retorna deleted=true com status ainda PENDING', async () => {
    const { getPayment } = await import('../asaas-ops');
    const { handlePaymentWebhook } = await import('../../webhooks/payment-webhook-handler');

    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_deleted_1',
      status: 'PENDING',
      value: 99,
      netValue: 99,
      billingType: 'PIX',
      dueDate: '2026-02-07',
      object: 'payment',
      dateCreated: '2026-02-07',
      customer: 'cus_1',
      originalDueDate: '2026-02-07',
      deleted: true,
    } as never);

    vi.mocked(handlePaymentWebhook).mockResolvedValueOnce({ success: true } as never);

    const result = await syncPaymentStateFromAsaas({
      contaId: 'conta_1',
      asaasPaymentId: 'pay_deleted_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.paymentStatus).toBe('PENDING');
      expect(result.appliedEvent).toBe('PAYMENT_DELETED');
    }

    expect(handlePaymentWebhook).toHaveBeenCalledWith(
      'conta_1',
      expect.objectContaining({
        event: 'PAYMENT_DELETED',
        payment: expect.objectContaining({
          id: 'pay_deleted_1',
          status: 'PENDING',
          deleted: true,
        }),
      })
    );
  });

  it('respeita eventName explícito para reprocessar undo de recebimento em dinheiro', async () => {
    const { getPayment } = await import('../asaas-ops');
    const { handlePaymentWebhook } = await import('../../webhooks/payment-webhook-handler');

    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_cash_undo',
      status: 'PENDING',
      value: 70.4,
      netValue: 69.41,
      billingType: 'PIX',
      dueDate: '2026-03-10',
      object: 'payment',
      dateCreated: '2026-03-09',
      customer: 'cus_1',
      originalDueDate: '2026-03-10',
      deleted: false,
    } as never);

    vi.mocked(handlePaymentWebhook).mockResolvedValueOnce({ success: true } as never);

    const result = await syncPaymentStateFromAsaas({
      contaId: 'conta_1',
      asaasPaymentId: 'pay_cash_undo',
      eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.paymentStatus).toBe('PENDING');
      expect(result.appliedEvent).toBe('PAYMENT_RECEIVED_IN_CASH_UNDONE');
    }

    expect(handlePaymentWebhook).toHaveBeenCalledWith(
      'conta_1',
      expect.objectContaining({
        event: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        payment: expect.objectContaining({
          id: 'pay_cash_undo',
          status: 'PENDING',
        }),
      })
    );
  });
});
