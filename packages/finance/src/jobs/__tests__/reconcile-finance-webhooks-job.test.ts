import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    financeReconciliationRun: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../../foundation/webhook-job-lock.service', () => ({
  withWebhookJobLock: vi.fn(async (_name: string, fn: () => Promise<unknown>) => ({
    acquired: true,
    result: await fn(),
    jobName: 'reconcile-finance-webhooks:global',
    workerId: 'test-worker',
  })),
}));

vi.mock('../../webhooks/webhook-reconciliation.service', () => ({
  detectWebhookGaps: vi.fn(),
  reconcileWithAsaas: vi.fn(),
}));

import { prisma } from '@alusa/database';
import { detectWebhookGaps, reconcileWithAsaas } from '../../webhooks/webhook-reconciliation.service';
import { reconcileFinanceWebhooksJob } from '../reconcile-finance-webhooks-job';

function reconcileResult(contaId: string, errors: string[] = []) {
  return {
    contaId,
    dryRun: false,
    mode: 'targeted' as const,
    correlationId: 'correlation-test',
    startedAt: new Date(),
    completedAt: new Date(),
    durationMs: 5,
    asaasCalls: 2,
    maxAsaasCalls: 100,
    budgetExhausted: false,
    providerCheckIntervalMinutes: 360,
    checkedPayments: 1,
    reconciledPayments: 0,
    paymentDrift: 0,
    checkedSubscriptions: 0,
    reconciledSubscriptions: 0,
    subscriptionDrift: 0,
    checkedInstallments: 0,
    installmentDrift: 0,
    errors,
    generatedAt: new Date(),
  };
}

describe('reconcileFinanceWebhooksJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.asaasAccount.findMany).mockResolvedValue([
      { id: 'account-a', financeProfile: { contaId: 'conta-a' } },
      { id: 'account-b', financeProfile: { contaId: 'conta-b' } },
      { id: 'account-c', financeProfile: { contaId: 'conta-c' } },
    ] as never);
    vi.mocked(prisma.asaasAccount.updateMany).mockResolvedValue({ count: 3 });
    vi.mocked(prisma.financeReconciliationRun.create).mockResolvedValue({ id: 'run-1' } as never);
    vi.mocked(detectWebhookGaps).mockResolvedValue({
      chargesWithMissingFinalStatus: [],
      subscriptionsWithMissingEvents: [],
    });
    vi.mocked(reconcileWithAsaas).mockImplementation(async ({ contaId }) => reconcileResult(contaId));
  });

  it('seleciona contas por fairness persistente e limita concorrência', async () => {
    let active = 0;
    let maxActive = 0;
    vi.mocked(reconcileWithAsaas).mockImplementation(async ({ contaId }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return reconcileResult(contaId);
    });

    const result = await reconcileFinanceWebhooksJob({ maxAccounts: 3, accountConcurrency: 2 });

    expect(prisma.asaasAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ lastFinanceReconciliationAt: 'asc' }, { updatedAt: 'asc' }],
    }));
    expect(prisma.asaasAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastFinanceReconciliationAt: expect.any(Date) },
    }));
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result.accountsProcessed).toBe(3);
    expect(result.asaasCalls).toBe(6);
    expect(result.outcome).toBe('completed');
  });

  it('retorna partial e erro sanitizado quando uma conta falha', async () => {
    vi.mocked(reconcileWithAsaas).mockImplementation(async ({ contaId }) => {
      if (contaId === 'conta-b') throw new Error('secret-token-must-not-leak');
      return reconcileResult(contaId);
    });

    const result = await reconcileFinanceWebhooksJob({ maxAccounts: 3 });

    expect(result.outcome).toBe('partial');
    expect(result.accountsFailed).toBe(1);
    expect(result.errors.join(' ')).not.toContain('secret-token-must-not-leak');
    expect(result.errors.join(' ')).toContain('unknown_error');
  });
});
