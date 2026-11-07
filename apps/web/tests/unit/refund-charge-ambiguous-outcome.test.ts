import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  records: vi.fn(),
  activeRefund: vi.fn(),
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
  findActivePaymentRefundCommand: mocks.activeRefund,
  claimPaymentRefundCommandForDispatch: mocks.claim,
  claimPaymentCommandForDispatch: mocks.claim,
  isAsaasEnabled: vi.fn(() => true),
  markPaymentCommandSent: mocks.markSent,
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
    mocks.activeRefund.mockReset().mockResolvedValue(null);
    mocks.bankSlip.mockReset();
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

    expect(mocks.claim).toHaveBeenCalledWith({ contaId: 'tenant-a', jobId: 'command-a', asaasPaymentId: 'payment-a', providerStatus: 'RECEIVED' });
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'command-a' }));
    expect(mocks.markNeedsReconciliation).toHaveBeenCalledWith({ jobId: 'command-a', error: expect.any(Error) });
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it('dispatches only the atomic-claim winner for PIX and boleto refunds', async () => {
    mocks.refund.mockResolvedValue(undefined);
    mocks.bankSlip.mockResolvedValue({ requestUrl: 'https://asaas.com/refund/request-a' });
    mocks.claim.mockResolvedValueOnce({ claimed: true, activeCommand: { id: 'command-a', correlationId: 'pix-corr', commandStatus: 'SENT_TO_ASAAS' } })
      .mockResolvedValueOnce({ claimed: false, activeCommand: { id: 'command-a', correlationId: 'pix-corr', commandStatus: 'SENT_TO_ASAAS' } });

    const pixResults = await Promise.all([
      executeCobrancaRefund({ contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'pix-corr', body: {} }),
      executeCobrancaRefund({ contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'pix-corr', body: {} }),
    ]);
    expect(pixResults.map((result) => result.status)).toEqual([202, 202]);
    expect(mocks.refund).toHaveBeenCalledTimes(1);

    mocks.refund.mockClear();
    mocks.claim.mockReset()
      .mockResolvedValueOnce({ claimed: true, activeCommand: { id: 'command-a', correlationId: 'boleto-corr', commandStatus: 'SENT_TO_ASAAS' } })
      .mockResolvedValueOnce({ claimed: false, activeCommand: { id: 'command-a', correlationId: 'boleto-corr', commandStatus: 'SENT_TO_ASAAS' } });
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

  it('returns a terminal response when retrying an idempotency key for a failed command', async () => {
    mocks.register.mockResolvedValueOnce({
      id: 'command-a', payload: { commandStatus: 'FAILED' },
    });

    const response = await executeCobrancaRefund({
      contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'same-terminal-key', body: {},
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'REFUND_COMMAND_FAILED', correlationId: 'same-terminal-key' });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('does not report a failed boleto refund as pending without a new dispatch', async () => {
    mocks.preflight.mockResolvedValueOnce({ id: 'payment-a', status: 'RECEIVED', billingType: 'BOLETO', value: 50 });
    mocks.register.mockResolvedValueOnce({ id: 'command-a', payload: { commandStatus: 'FAILED' } });

    const response = await executeCobrancaRefund({
      contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'failed-boleto-key', body: {},
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'REFUND_COMMAND_FAILED', correlationId: 'failed-boleto-key' });
    expect(mocks.bankSlip).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('returns a conflict when an idempotency key is reused with different refund data', async () => {
    mocks.register.mockRejectedValueOnce(new Error('PAYMENT_COMMAND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'));

    const response = await executeCobrancaRefund({
      contaId: 'tenant-a',
      userId: 'user-a',
      id: 'charge-a',
      correlationId: 'same-refund-key',
      body: { value: 20, splitRefunds: [{ id: 'wallet-a', value: 20 }] },
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', correlationId: 'same-refund-key' });
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      requestFingerprint: JSON.stringify({ value: 20, splitRefunds: [['wallet-a', 20]] }),
    }));
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('returns the existing pending refund when a different key targets the same payment', async () => {
    mocks.activeRefund.mockResolvedValueOnce({
      id: 'existing-command', correlationId: 'original-refund-key', commandStatus: 'NEEDS_RECONCILIATION',
    });

    const response = await executeCobrancaRefund({
      contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'new-refund-key', body: {},
    });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ correlationId: 'original-refund-key', pending: true });
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('allows a fresh refund command after the previous command is terminal', async () => {
    mocks.activeRefund.mockResolvedValueOnce(null);
    mocks.refund.mockResolvedValueOnce(undefined);

    const response = await executeCobrancaRefund({
      contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId: 'fresh-refund-key', body: {},
    });

    expect(response.status).toBe(202);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'fresh-refund-key' }));
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });

  it('reuses one dispatch for a repeated idempotency header and does not dispatch a second active refund with a new header', async () => {
    const statuses = new Map<string, string>();
    const claimed = new Set<string>();
    const correlationByCommand = new Map<string, string>();
    let activeCorrelation: string | null = null;
    mocks.register.mockImplementation(async (input: { correlationId: string }) => {
      const id = `command-${input.correlationId}`;
      correlationByCommand.set(id, input.correlationId);
      return { id, payload: { commandStatus: statuses.get(id) ?? 'REQUESTED' } };
    });
    mocks.activeRefund.mockImplementation(async () => activeCorrelation
      ? { id: `command-${activeCorrelation}`, correlationId: activeCorrelation, commandStatus: 'SENT_TO_ASAAS' }
      : null);
    mocks.claim.mockImplementation(async (input: { jobId: string }) => {
      if (claimed.has(input.jobId)) return { claimed: false };
      claimed.add(input.jobId);
      statuses.set(input.jobId, 'SENT_TO_ASAAS');
      activeCorrelation = correlationByCommand.get(input.jobId) ?? activeCorrelation;
      return { claimed: true };
    });
    mocks.refund.mockResolvedValue(undefined);

    const run = (correlationId: string) => executeCobrancaRefund({
      contaId: 'tenant-a', userId: 'user-a', id: 'charge-a', correlationId, body: {},
    });
    const first = await run('refund-header-a');
    const retry = await run('refund-header-a');
    const separate = await run('refund-header-b');

    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    expect(separate.status).toBe(202);
    expect(mocks.register.mock.calls.map(([input]) => input.correlationId)).toEqual([
      'refund-header-a', 'refund-header-a',
    ]);
    expect(separate.body).toMatchObject({ correlationId: 'refund-header-a', pending: true });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund.mock.calls.map(([input]) => input.idempotencyKey)).toEqual(['command-refund-header-a']);
  });
});
