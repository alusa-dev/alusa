import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  finance: {
    auditLogService: { record: vi.fn() },
    numberFromFinanceDecimal: vi.fn((value: unknown) => Number(value)),
    readPaymentFullPreflight: vi.fn(),
    findActivePaymentRefundCommand: vi.fn(),
    runAsaasPaymentCommand: vi.fn(),
    syncPaymentStateFromAsaas: vi.fn(),
  },
  tx: {
    usuarioConta: { findFirst: vi.fn() },
    conta: { findFirst: vi.fn() },
    cobranca: { findFirst: vi.fn() },
    charge: { findFirst: vi.fn() },
    asaasIntegrationJob: { findUnique: vi.fn() },
  },
}));

vi.mock('@alusa/finance', () => ({
  ...mocks.finance,
  createStandaloneCharge: vi.fn(),
  deleteCharge: vi.fn(),
  deletePayment: vi.fn(),
  FORMA_PAGAMENTO_TO_ASAAS: {},
  getMobileBillingSummary: vi.fn(),
  markChargeAsPaid: vi.fn(),
  resolveMobileBillingCategory: vi.fn(),
  roundFinanceCurrency: vi.fn((value: number) => value),
  refundCobranca: vi.fn(),
  updateCharge: vi.fn(),
  updatePayment: vi.fn(),
  undoCashPayment: vi.fn(),
  evaluatePaymentActionPolicy: vi.fn(),
}));
vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: vi.fn(async (_contaId: string, callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx)),
}));

import { executeMobileBillingAction } from '@/features/billing/server/mobile-billing.service';

describe('mobile billing refund command replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.usuarioConta.findFirst.mockResolvedValue({ id: 'membership-1', role: 'FINANCEIRO' });
    mocks.tx.conta.findFirst.mockResolvedValue({ id: 'tenant-1' });
    mocks.tx.cobranca.findFirst.mockResolvedValue({
      id: 'charge-1', asaasPaymentId: 'payment-1', valorFinal: 50, valor: 50,
      status: 'PAGO', formaPagamento: 'PIX', vencimento: null, descricao: 'Mensalidade',
    });
    mocks.tx.asaasIntegrationJob.findUnique.mockResolvedValue({
      payload: {
        commandType: 'PAYMENT_REFUND_COMMAND', entityId: 'charge-1', asaasPaymentId: 'payment-1',
        commandStatus: 'CONFIRMED_BY_WEBHOOK',
      },
    });
  });

  it('returns confirmed success for a replay after webhook confirmation without preflight or redispatch', async () => {
    const result = await executeMobileBillingAction({
      actor: { userId: 'user-1', contaId: 'tenant-1' }, chargeId: 'charge-1', action: 'REFUND', correlationId: 'mobile-refund-key-1',
    });

    expect(result).toEqual({
      success: true,
      message: 'Estorno já confirmado.',
      correlationId: 'mobile-refund-key-1',
      commandStatus: 'CONFIRMED_BY_WEBHOOK',
    });
    expect(mocks.finance.readPaymentFullPreflight).not.toHaveBeenCalled();
    expect(mocks.finance.runAsaasPaymentCommand).not.toHaveBeenCalled();
  });

  it('returns terminal failure for a replay of a failed refund command', async () => {
    mocks.tx.asaasIntegrationJob.findUnique.mockResolvedValueOnce({
      payload: {
        commandType: 'PAYMENT_REFUND_COMMAND', entityId: 'charge-1', asaasPaymentId: 'payment-1',
        commandStatus: 'FAILED',
      },
    });

    const result = await executeMobileBillingAction({
      actor: { userId: 'user-1', contaId: 'tenant-1' }, chargeId: 'charge-1', action: 'REFUND', correlationId: 'mobile-refund-key-1',
    });

    expect(result).toMatchObject({ success: false, code: 'ACTION_NOT_ALLOWED' });
    expect(mocks.finance.readPaymentFullPreflight).not.toHaveBeenCalled();
    expect(mocks.finance.runAsaasPaymentCommand).not.toHaveBeenCalled();
  });

  it('returns the active refund correlation for a new key on the same payment', async () => {
    mocks.tx.asaasIntegrationJob.findUnique.mockResolvedValueOnce(null);
    mocks.finance.findActivePaymentRefundCommand.mockResolvedValueOnce({
      id: 'command-existing', correlationId: 'original-mobile-key', commandStatus: 'SENT_TO_ASAAS',
    });

    const result = await executeMobileBillingAction({
      actor: { userId: 'user-1', contaId: 'tenant-1' }, chargeId: 'charge-1', action: 'REFUND', correlationId: 'new-mobile-key',
    });

    expect(result).toMatchObject({ success: true, pending: true, correlationId: 'original-mobile-key', commandStatus: 'SENT_TO_ASAAS' });
    expect(mocks.finance.readPaymentFullPreflight).not.toHaveBeenCalled();
    expect(mocks.finance.runAsaasPaymentCommand).not.toHaveBeenCalled();
  });
});
