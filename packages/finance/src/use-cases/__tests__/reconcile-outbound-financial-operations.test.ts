import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jobs: { findMany: vi.fn(), update: vi.fn() },
  chargeUpdateMany: vi.fn(),
  transaction: vi.fn(async (items: unknown[]) => Promise.all(items)),
  listPayments: vi.fn(),
  syncPayment: vi.fn(),
  markConfirmed: vi.fn(),
  markSynchronized: vi.fn(),
  markUnknown: vi.fn(),
  markRequires: vi.fn(),
  resolveIssue: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    asaasIntegrationJob: mocks.jobs,
    charge: { updateMany: mocks.chargeUpdateMany },
    subscription: { updateMany: vi.fn() },
    standaloneSubscription: { updateMany: vi.fn() },
    installmentPlan: { updateMany: vi.fn() },
    standaloneInstallmentPlan: { updateMany: vi.fn() },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@alusa/asaas', () => ({ listPayments: vi.fn() }));
vi.mock('../asaas-ops', () => ({
  listPayments: mocks.listPayments,
  listSubscriptions: vi.fn(),
  getSubscription: vi.fn(),
  getInstallment: vi.fn(),
  getPayment: vi.fn(),
}));
vi.mock('../sync-payment-state-from-asaas', () => ({
  syncPaymentStateFromAsaas: mocks.syncPayment,
}));
vi.mock('../outbound-financial-operation', async () => {
  const actual = await vi.importActual<typeof import('../outbound-financial-operation')>('../outbound-financial-operation');
  return {
    ...actual,
    markOutboundRemoteConfirmed: mocks.markConfirmed,
    markOutboundSynchronized: mocks.markSynchronized,
    markOutboundResultUnknown: mocks.markUnknown,
    markOutboundRequiresReconciliation: mocks.markRequires,
  };
});
vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  buildFinanceReconciliationIssueDedupeKey: vi.fn(() => 'dedupe-1'),
  resolveFinanceReconciliationIssueByDedupe: mocks.resolveIssue,
}));

import { reconcileOutboundFinancialOperations } from '../reconcile-outbound-financial-operations';

const operationPayload = {
  version: 1,
  state: 'RESULT_UNKNOWN',
  resource: 'PAYMENT',
  entityId: 'charge-1',
  externalReference: 'alusa:standalone:charge-1',
  correlationId: 'idem-1',
  requestFingerprint: 'fingerprint-1',
};

describe('reconcileOutboundFinancialOperations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recupera POST com resposta perdida pela externalReference e converge o estado local', async () => {
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-1', contaId: 'tenant-a', type: 'CREATE_PAYMENT', status: 'PROCESSING',
      attempts: 1, chargeId: 'charge-1', payload: operationPayload,
    }]);
    mocks.listPayments.mockResolvedValueOnce({
      data: [{ id: 'pay-1', externalReference: operationPayload.externalReference, status: 'PENDING', invoiceUrl: 'https://invoice' }],
    });
    mocks.syncPayment.mockResolvedValueOnce({ success: true });

    const result = await reconcileOutboundFinancialOperations({ contaId: 'tenant-a' });

    expect(result).toEqual({ scanned: 1, recovered: 1, missing: 0, divergent: 0 });
    expect(mocks.jobs.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'tenant-a' }),
    }));
    expect(mocks.chargeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'tenant-a' }),
      data: expect.objectContaining({ asaasPaymentId: 'pay-1' }),
    }));
    expect(mocks.syncPayment).toHaveBeenCalledWith({
      contaId: 'tenant-a', asaasPaymentId: 'pay-1', intent: 'RECONCILIATION',
    });
    expect(mocks.markSynchronized).toHaveBeenCalledWith('job-1', 'pay-1', expect.any(Object));
  });

  it('não escolhe arbitrariamente quando o Asaas contém duplicidade', async () => {
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-1', contaId: 'tenant-b', type: 'CREATE_PAYMENT', status: 'PROCESSING',
      attempts: 1, chargeId: 'charge-1', payload: operationPayload,
    }]);
    mocks.listPayments.mockResolvedValueOnce({
      data: [
        { id: 'pay-1', externalReference: operationPayload.externalReference },
        { id: 'pay-2', externalReference: operationPayload.externalReference },
      ],
    });

    const result = await reconcileOutboundFinancialOperations({ contaId: 'tenant-b' });

    expect(result.divergent).toBe(1);
    expect(mocks.chargeUpdateMany).not.toHaveBeenCalled();
    expect(mocks.markRequires).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-b',
      error: expect.objectContaining({ message: 'MULTIPLE_REMOTE_PAYMENTS_FOR_EXTERNAL_REFERENCE' }),
    }));
  });
});
