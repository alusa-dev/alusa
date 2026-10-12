import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adjustmentFindMany: vi.fn(), adjustmentUpdateMany: vi.fn(), agreementFindFirst: vi.fn(),
  createCharge: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    billingAdjustment: { findMany: mocks.adjustmentFindMany, updateMany: mocks.adjustmentUpdateMany },
    billingAgreement: { findFirst: mocks.agreementFindFirst },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({
      billingAdjustment: { updateMany: mocks.adjustmentUpdateMany },
    })),
  },
}));
vi.mock('../use-cases/create-standalone-charge', () => ({ createStandaloneCharge: mocks.createCharge }));
vi.mock('./asaas-subscription.adapter', () => ({ createAsaasBillingAgreementPort: () => ({}) }));
vi.mock('../use-cases/asaas-ops', () => ({ refundCobranca: vi.fn(), requestBankSlipRefund: vi.fn() }));
vi.mock('../reconciliation/finance-reconciliation-issue.service', () => ({ upsertFinanceReconciliationIssue: vi.fn() }));

import { decideBillingAdjustmentFailure, processPendingBillingAdjustments } from './adjustment-processor';

const NOW = new Date('2026-07-31T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adjustmentFindMany.mockResolvedValue([{
    id: 'adjustment-1', contaId: 'conta-1', agreementId: 'agreement-1', operationId: 'operation-1',
    type: 'COMPLEMENT', amount: 10, effectiveAt: NOW, attempts: 0, idempotencyKey: 'idem-1',
  }]);
  mocks.adjustmentUpdateMany.mockResolvedValue({ count: 1 });
  mocks.agreementFindFirst.mockResolvedValue({
    customer: { id: 'customer-1' }, payerType: 'ALUNO', payerId: 'student-1', billingType: 'BOLETO',
    externalReference: 'agreement-1',
  });
  mocks.createCharge.mockResolvedValue({ success: true, data: { asaasPaymentId: 'payment-1' } });
});

describe('decideBillingAdjustmentFailure', () => {
  it('não grava o estado do ajuste quando o guard do outbox falha após o efeito remoto', async () => {
    let transactionalChecks = 0;
    const ownershipGuard = async (tx?: unknown) => {
      if (!tx) return;
      transactionalChecks += 1;
      if (transactionalChecks > 1) throw new Error('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN');
    };

    await expect(processPendingBillingAdjustments({
      contaId: 'conta-1', operationId: 'operation-1', now: NOW, ownershipGuard,
    })).rejects.toThrow('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN');

    expect(mocks.createCharge).toHaveBeenCalledTimes(1);
    expect(mocks.adjustmentUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.adjustmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROCESSING' }),
    }));
    expect(mocks.adjustmentUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPLIED' }),
    }));
  });

  it('repete complemento com backoff antes de exigir reconciliação', () => {
    const retry = decideBillingAdjustmentFailure({
      type: 'COMPLEMENT', attemptsBeforeClaim: 0, message: 'ASAAS_UNAVAILABLE', now: NOW,
    });
    expect(retry.status).toBe('FAILED');
    expect(retry.reconcile).toBe(false);
    expect(retry.availableAt.getTime()).toBeGreaterThan(NOW.getTime());

    expect(decideBillingAdjustmentFailure({
      type: 'COMPLEMENT', attemptsBeforeClaim: 4, message: 'ASAAS_UNAVAILABLE', now: NOW,
    })).toEqual({ status: 'REQUIRES_RECONCILIATION', availableAt: NOW, reconcile: true });
  });

  it('mantém crédito pendente enquanto aguarda a próxima cobrança', () => {
    expect(decideBillingAdjustmentFailure({
      type: 'CREDIT', attemptsBeforeClaim: 8, message: 'CREDITO_AGUARDANDO_PROXIMA_COBRANCA', now: NOW,
    })).toEqual({
      status: 'PENDING',
      availableAt: new Date('2026-08-01T12:00:00.000Z'),
      reconcile: false,
    });
  });
});
