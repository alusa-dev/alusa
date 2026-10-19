import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  records: vi.fn(),
  register: vi.fn(),
  refund: vi.fn(),
  bankSlip: vi.fn(),
  preflight: vi.fn(),
  claim: vi.fn(),
  markSent: vi.fn(),
  markNeedsReconciliation: vi.fn(),
  fail: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  AsaasHttpError: class AsaasHttpError extends Error { constructor(message: string, public status: number) { super(message); } },
  KycNotApprovedError: class KycNotApprovedError extends Error {},
  auditLogService: { record: vi.fn() },
  evaluatePaymentActionPolicy: vi.fn(() => ({ canRefund: true, canPartialRefund: true, actions: { REFUND: { allowed: true }, PARTIAL_REFUND: { allowed: true } } })),
  expectedEventsForPaymentCommand: vi.fn(() => ['PAYMENT_REFUNDED']),
  failPaymentCommand: mocks.fail,
  isAsaasEnabled: vi.fn(() => true),
  markPaymentCommandSent: mocks.markSent,
  claimPaymentCommandForDispatch: mocks.claim,
  markPaymentCommandNeedsReconciliation: mocks.markNeedsReconciliation,
  normalizeAsaasPaymentSnapshotStatus: vi.fn((input: { status?: string }) => input.status),
  readPaymentFullPreflight: mocks.preflight,
  requestBankSlipRefund: mocks.bankSlip,
  refundCobranca: mocks.refund,
  registerPaymentCommand: mocks.register,
  syncPaymentStateFromAsaas: vi.fn(),
}));
vi.mock('@/src/prisma', () => ({ prisma: {} }));
vi.mock('@/features/finance/operations/charges/dtos', () => ({ cobrancaActionResultDTOSchema: { parse: (value: unknown) => value } }));
vi.mock('@/features/finance/operations/charges/mappers', () => ({ mapCobrancaActionResultToDTO: (value: unknown) => value }));
vi.mock('@/src/server/finance/resolve-charge-payment-lookup', () => ({
  loadCobrancaActionRecords: mocks.records,
  recordCobrancaFinancialLog: vi.fn(),
  resolveCobrancaPaymentLookupForTenant: vi.fn(),
}));
vi.mock('@alusa/finance/foundation/operational-log', () => ({ logFinanceOperationalEvent: vi.fn() }));
vi.mock('@alusa/lib/events/ticket-checkin.service', () => ({ isTicketPaymentBlocked: vi.fn(() => false) }));

import { executeCobrancaRefund } from '@/src/server/finance/refund-charge.service';

describe('refund command ambiguous outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.records.mockResolvedValue({
      cobranca: null,
      charge: { id: 'charge-a', asaasPaymentId: 'payment-a', status: 'PAID', value: 50, billingType: 'PIX' },
    });
    mocks.register.mockResolvedValue({ id: 'command-a', payload: { commandStatus: 'REQUESTED' } });
    mocks.refund.mockRejectedValue(new Error('network timeout after dispatch'));
    mocks.preflight.mockResolvedValue({ id: 'payment-a', status: 'RECEIVED', billingType: 'PIX', value: 50 });
    mocks.claim.mockResolvedValue({ claimed: true });
    mocks.markSent.mockResolvedValue(undefined);
    mocks.markNeedsReconciliation.mockResolvedValue(undefined);
    mocks.fail.mockResolvedValue(undefined);
  });

  it('marks a timed-out Asaas POST as reconciliation-required', async () => {
    await expect(executeCobrancaRefund({
      contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'store-return-stable', body: {},
    })).rejects.toThrow('network timeout after dispatch');

    expect(mocks.claim).toHaveBeenCalledWith({ contaId: 'tenant-a', jobId: 'command-a', providerStatus: 'RECEIVED' });
    expect(mocks.markNeedsReconciliation).toHaveBeenCalledWith({ jobId: 'command-a', error: expect.any(Error) });
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it('dispatches only the atomic-claim winner for PIX and boleto refunds', async () => {
    mocks.refund.mockResolvedValue(undefined);
    mocks.bankSlip.mockResolvedValue({ requestUrl: 'https://asaas.com/refund/request-a' });
    mocks.claim.mockResolvedValueOnce({ claimed: true }).mockResolvedValueOnce({ claimed: false });

    const pixResults = await Promise.all([
      executeCobrancaRefund({ contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'pix-corr', body: {} }),
      executeCobrancaRefund({ contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'pix-corr', body: {} }),
    ]);
    expect(pixResults.map((result) => result.status)).toEqual([202, 202]);
    expect(mocks.refund).toHaveBeenCalledTimes(1);

    mocks.refund.mockClear();
    mocks.claim.mockReset().mockResolvedValueOnce({ claimed: true }).mockResolvedValueOnce({ claimed: false });
    mocks.preflight.mockResolvedValue({ id: 'payment-a', status: 'RECEIVED', billingType: 'BOLETO', value: 50 });
    const boletoResults = await Promise.all([
      executeCobrancaRefund({ contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'boleto-corr', body: {} }),
      executeCobrancaRefund({ contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'boleto-corr', body: {} }),
    ]);
    expect(boletoResults.map((result) => result.status)).toEqual([202, 202]);
    expect(mocks.bankSlip).toHaveBeenCalledTimes(1);
  });

  it('does not issue a second refund POST while command outcome is unresolved', async () => {
    mocks.register.mockResolvedValueOnce({
      id: 'command-a', payload: { commandStatus: 'NEEDS_RECONCILIATION' },
    });

    const result = await executeCobrancaRefund({
      contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'store-return-stable', body: {},
    });

    expect(result.status).toBe(202);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.markSent).not.toHaveBeenCalled();
  });
});
