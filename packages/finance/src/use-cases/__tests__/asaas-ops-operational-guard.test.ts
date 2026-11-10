import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAsaasCredentialsMock = vi.fn();
const requireKycApprovedMock = vi.fn();
const ensureWebhookConfigOperationalMock = vi.fn();

const asaasNotifyPaymentMock = vi.fn();
const asaasUndoReceivedInCashMock = vi.fn();
const asaasCreateSubscriptionMock = vi.fn();
const asaasRefundPaymentMock = vi.fn();

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: loadAsaasCredentialsMock,
}));

vi.mock('../../foundation/kyc-guard', () => ({
  requireKycApproved: requireKycApprovedMock,
}));

vi.mock('../../webhooks/ensure-webhook-config-operational', () => ({
  ensureWebhookConfigOperational: ensureWebhookConfigOperationalMock,
}));

vi.mock('@alusa/asaas', () => ({
  deleteInstallmentPayments: vi.fn(),
  deletePayment: vi.fn(),
  listPayments: vi.fn(),
  getPayment: vi.fn(),
  getPaymentStatus: vi.fn(),
  getInstallment: vi.fn(),
  notifyPayment: asaasNotifyPaymentMock,
  receiveInCash: vi.fn(),
  undoReceivedInCash: asaasUndoReceivedInCashMock,
  refundPayment: asaasRefundPaymentMock,
  getBillingInfo: vi.fn(),
  updatePayment: vi.fn(),
  getSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  createSubscription: asaasCreateSubscriptionMock,
  listSubscriptionPayments: vi.fn(),
  listInstallmentPayments: vi.fn(),
  updateSubscriptionCreditCard: vi.fn(),
}));

describe('asaas-ops operational guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireKycApprovedMock.mockResolvedValue({ success: true });
    ensureWebhookConfigOperationalMock.mockResolvedValue(undefined);
    loadAsaasCredentialsMock.mockResolvedValue({ apiKey: 'asaas_key' });
    asaasNotifyPaymentMock.mockResolvedValue({ success: true, message: 'ok' });
    asaasUndoReceivedInCashMock.mockResolvedValue({ id: 'pay_1' });
    asaasCreateSubscriptionMock.mockResolvedValue({ id: 'sub_1' });
    asaasRefundPaymentMock.mockResolvedValue({ id: 'pay_1' });
  });

  it('bloqueia reenviarCobranca antes da mutação quando o tenant não está operacional', async () => {
    const { reenviarCobranca } = await import('../asaas-ops');
    ensureWebhookConfigOperationalMock.mockRejectedValueOnce(new Error('Financeiro bloqueado'));

    await expect(
      reenviarCobranca({
        contaId: 'conta_1',
        paymentId: 'pay_1',
        tipo: 'EMAIL',
      }),
    ).rejects.toThrow('Financeiro bloqueado');

    expect(asaasNotifyPaymentMock).not.toHaveBeenCalled();
    expect(loadAsaasCredentialsMock).not.toHaveBeenCalled();
  });

  it('bloqueia undoCashPayment antes da mutação quando o tenant não está operacional', async () => {
    const { undoCashPayment } = await import('../asaas-ops');
    ensureWebhookConfigOperationalMock.mockRejectedValueOnce(new Error('Financeiro bloqueado'));

    await expect(undoCashPayment('pay_1', { contaId: 'conta_1' })).rejects.toThrow('Financeiro bloqueado');

    expect(asaasUndoReceivedInCashMock).not.toHaveBeenCalled();
    expect(loadAsaasCredentialsMock).not.toHaveBeenCalled();
  });

  it('propaga a identidade persistente do comando ao transporte do refund', async () => {
    const { refundCobranca } = await import('../asaas-ops');
    await refundCobranca({ paymentId: 'pay_1', contaId: 'conta_1', idempotencyKey: 'command-stable-1' });

    expect(asaasRefundPaymentMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'asaas_key', paymentId: 'pay_1', idempotencyKey: 'command-stable-1',
    }));
  });

  it('bloqueia reativarAssinatura antes da mutação quando o tenant não está operacional', async () => {
    const { reativarAssinatura } = await import('../asaas-ops');
    ensureWebhookConfigOperationalMock.mockRejectedValueOnce(new Error('Financeiro bloqueado'));

    await expect(
      reativarAssinatura({
        contaId: 'conta_1',
        customer: 'cus_1',
        billingType: 'BOLETO',
        nextDueDate: '2026-05-20',
        value: 100,
        cycle: 'MONTHLY',
        externalReference: 'sub:1',
      }),
    ).rejects.toThrow('Financeiro bloqueado');

    expect(asaasCreateSubscriptionMock).not.toHaveBeenCalled();
    expect(loadAsaasCredentialsMock).not.toHaveBeenCalled();
  });
});
