import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type AsyncMock<Args extends unknown[], Result> = Mock<Args, Result>;

type TestAccount = {
  id: string;
  contaId: string;
  planCode: string;
  stripeSubscriptionId: string;
  trialEndsAt: Date;
};

type TestTenantTx = {
  account: TestAccount;
  $queryRaw: AsyncMock<[], Promise<Array<{ id: string }>>>;
  platformBillingAccount: {
    findMany: AsyncMock<[args: Record<string, unknown>], Promise<TestAccount[]>>;
    findFirst: AsyncMock<[args: Record<string, unknown>], Promise<TestAccount | null>>;
    update: AsyncMock<[args: Record<string, unknown>], Promise<unknown>>;
    updateMany: AsyncMock<[args: Record<string, unknown>], Promise<unknown>>;
  };
  platformBillingIssue: {
    createMany: AsyncMock<[args: { data: Array<{ fingerprint: string }>; skipDuplicates?: boolean }], Promise<{ count: number }>>;
    upsert: AsyncMock<[args: Record<string, unknown>], Promise<unknown>>;
  };
  platformBillingAuditLog: { create: AsyncMock<[args: Record<string, unknown>], Promise<unknown>> };
  platformBillingNotificationOutbox: {
    createMany: AsyncMock<[args: { data: Array<{ environment: string; eventId: string; eventType: string; contaId: string }>; skipDuplicates?: boolean }], Promise<{ count: number }>>;
  };
};

const { state, runWithTenantMock } = vi.hoisted(() => {
  const state = {
    transactions: {} as Record<string, TestTenantTx>,
    claims: new Set<string>(),
    queuedEvents: new Set<string>(),
    paidAccounts: new Set<string>(),
    simulatePaymentWhileLocked: false,
    issueStatus: 'ABSENT' as 'ABSENT' | 'OPEN' | 'RESOLVED',
    releaseBillingLock: null as (() => void) | null,
    lockReleased: null as Promise<void> | null,
    pendingPayment: null as Promise<void> | null,
    prisma: {
      platformBillingAccount: {
        count: vi.fn(async () => Object.values(state.transactions)
          .map((transaction) => transaction.account)
          .filter((account) => !state.claims.has(`${account.id}:trial-expired`)).length),
        findMany: vi.fn(async ({ skip, take }: { skip: number; take: number }) => Object.values(state.transactions)
          .map((transaction) => transaction.account)
          .filter((account) => !state.claims.has(`${account.id}:trial-expired`))
          .slice(skip, skip + take)),
      },
    },
  };
  const runWithTenantMock = vi.fn(async (
    contaId: string,
    callback: (_transaction: TestTenantTx) => Promise<unknown>,
  ) => {
    const transaction = state.transactions[contaId];
    if (!transaction) throw new Error(`Missing test transaction for ${contaId}`);
    try {
      return await callback(transaction);
    } finally {
      if (state.releaseBillingLock) {
        state.releaseBillingLock();
        state.releaseBillingLock = null;
        await state.pendingPayment;
        state.pendingPayment = null;
        state.lockReleased = null;
      }
    }
  });
  return { state, runWithTenantMock };
});

vi.mock('@/lib/prisma', () => ({ prisma: state.prisma }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: runWithTenantMock }));
vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  resolvePlatformBillingEnvironment: () => 'TEST',
}));

import { expirePlatformBillingTrials } from './trial-jobs';

describe('expirePlatformBillingTrials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.claims = new Set();
    state.queuedEvents = new Set();
    state.paidAccounts = new Set();
    state.simulatePaymentWhileLocked = false;
    state.issueStatus = 'ABSENT';
    state.releaseBillingLock = null;
    state.lockReleased = null;
    state.pendingPayment = null;
    state.transactions = { conta_a: makeTenantTx(makeAccount('conta_a', 'billing-a')) };
  });

  it('rechecks under the row lock after candidate discovery and creates no issue, audit, or notice when payment won', async () => {
    const tx = state.transactions.conta_a!;
    tx.$queryRaw.mockImplementationOnce(async () => {
      state.paidAccounts.add('billing-a');
      return [{ id: 'billing-a' }];
    });

    const result = await expirePlatformBillingTrials({ now: NOW, environment: 'TEST' });

    expect(result).toEqual({ checked: 1, detected: 0, notificationQueued: 0 });
    expect(runWithTenantMock.mock.calls.map(([contaId]) => contaId)).toEqual(['conta_a']);
    expect(state.prisma.platformBillingAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        environment: 'TEST',
        ...expiredUnpaidFilter(),
        conta: { is: { status: 'ATIVO', deletedAt: null } },
        issues: { none: { environment: 'TEST', code: 'TRIAL_EXPIRED_WITHOUT_PAYMENT', status: 'OPEN' } },
      }),
      take: 100,
    }));
    expect(tx.platformBillingAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'billing-a', contaId: 'conta_a', environment: 'TEST', ...expiredUnpaidFilter() },
    }));
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.platformBillingIssue.createMany).not.toHaveBeenCalled();
    expect(tx.platformBillingIssue.upsert).not.toHaveBeenCalled();
    expect(tx.platformBillingAuditLog.create).not.toHaveBeenCalled();
    expect(tx.platformBillingNotificationOutbox.createMany).not.toHaveBeenCalled();
    expect(tx.platformBillingAccount.update).not.toHaveBeenCalled();
    expect(tx.platformBillingAccount.updateMany).not.toHaveBeenCalled();
  });

  it('serializes payment during issue registration and leaves the final issue resolved', async () => {
    const tx = state.transactions.conta_a!;
    state.simulatePaymentWhileLocked = true;

    const result = await expirePlatformBillingTrials({ now: NOW, environment: 'TEST' });

    expect(result.detected).toBe(1);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.platformBillingIssue.upsert).toHaveBeenCalledOnce();
    expect(state.paidAccounts.has('billing-a')).toBe(true);
    expect(state.issueStatus).toBe('RESOLVED');
    expect(tx.platformBillingAccount.update).not.toHaveBeenCalled();
    expect(tx.platformBillingAccount.updateMany).not.toHaveBeenCalled();
  });

  it('keeps reads and writes inside each Conta context for two tenants', async () => {
    const txA = makeTenantTx(makeAccount('conta_a', 'billing-a'));
    const txB = makeTenantTx(makeAccount('conta_b', 'billing-b'));
    state.transactions = { conta_a: txA, conta_b: txB };

    const result = await expirePlatformBillingTrials({ now: NOW, environment: 'TEST' });

    expect(result).toEqual({ checked: 2, detected: 2, notificationQueued: 2 });
    expect(state.prisma.platformBillingAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ conta: { is: { status: 'ATIVO', deletedAt: null } } }),
      take: 100,
    }));
    expect(runWithTenantMock.mock.calls.map(([contaId]) => contaId)).toEqual([
      'conta_a', 'conta_b',
    ]);
    expect(txA.platformBillingIssue.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ contaId: 'conta_a', billingAccountId: 'billing-a' })],
    }));
    expect(txB.platformBillingIssue.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ contaId: 'conta_b', billingAccountId: 'billing-b' })],
    }));
    expect(txA.platformBillingAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contaId: 'conta_a', billingAccountId: 'billing-a' }),
    }));
    expect(txB.platformBillingAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contaId: 'conta_b', billingAccountId: 'billing-b' }),
    }));
  });

  it('caps total work and advances to remaining overdue trials on the next run', async () => {
    state.transactions = {
      conta_a: makeTenantTx(makeAccount('conta_a', 'billing-a')),
      conta_b: makeTenantTx(makeAccount('conta_b', 'billing-b')),
      conta_c: makeTenantTx(makeAccount('conta_c', 'billing-c')),
    };

    const first = await expirePlatformBillingTrials({ now: NOW, environment: 'TEST', limit: 2 });
    const second = await expirePlatformBillingTrials({ now: NOW, environment: 'TEST', limit: 2 });

    expect(first.checked).toBe(2);
    expect(second.checked).toBe(1);
    expect(runWithTenantMock.mock.calls.map(([contaId]) => contaId)).toEqual([
      'conta_a', 'conta_b', 'conta_c',
    ]);
    expect(state.prisma.platformBillingAccount.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 2 }),
    );
    expect(state.prisma.platformBillingAccount.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ take: 2 }),
    );
  });

  it('rotates between eligible tenants across cron intervals when earlier candidates remain eligible', async () => {
    state.transactions = {
      conta_a: makeTenantTx(makeAccount('conta_a', 'billing-a')),
      conta_b: makeTenantTx(makeAccount('conta_b', 'billing-b')),
      conta_c: makeTenantTx(makeAccount('conta_c', 'billing-c')),
      conta_d: makeTenantTx(makeAccount('conta_d', 'billing-d')),
    };
    for (const transaction of Object.values(state.transactions)) {
      transaction.$queryRaw.mockResolvedValue([]);
    }

    const first = await expirePlatformBillingTrials({ now: NOW, environment: 'TEST', limit: 2 });
    const firstTenants = runWithTenantMock.mock.calls.map(([contaId]) => contaId);
    runWithTenantMock.mockClear();
    const second = await expirePlatformBillingTrials({
      now: new Date(NOW.getTime() + 5 * 60 * 1000),
      environment: 'TEST',
      limit: 2,
    });
    const secondTenants = runWithTenantMock.mock.calls.map(([contaId]) => contaId);

    expect(first.checked).toBe(2);
    expect(second.checked).toBe(2);
    expect(new Set(secondTenants).size).toBe(2);
    expect(secondTenants).not.toEqual(firstTenants);
    expect(state.prisma.platformBillingAccount.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 2, skip: expect.any(Number) }),
    );
    expect(state.prisma.platformBillingAccount.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ take: 2, skip: expect.any(Number) }),
    );
  });

  it('uses issue uniqueness as an audit claim and queues notification intent idempotently', async () => {
    const tx = state.transactions.conta_a!;

    const first = await expirePlatformBillingTrials({ now: NOW, environment: 'TEST' });
    const second = await expirePlatformBillingTrials({ now: NOW, environment: 'TEST' });

    expect(first).toEqual({ checked: 1, detected: 1, notificationQueued: 1 });
    expect(second).toEqual({ checked: 0, detected: 0, notificationQueued: 0 });
    expect(tx.platformBillingIssue.createMany).toHaveBeenCalledOnce();
    expect(tx.platformBillingIssue.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(tx.platformBillingAuditLog.create).toHaveBeenCalledOnce();
    expect(tx.platformBillingIssue.upsert).toHaveBeenCalledOnce();
    expect(tx.platformBillingNotificationOutbox.createMany).toHaveBeenCalledOnce();
    expect(tx.platformBillingNotificationOutbox.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ environment: 'TEST', eventId: 'trial-expired:billing-a', eventType: 'platform.billing_trial_expired', contaId: 'conta_a' }],
      skipDuplicates: true,
    }));
    expect(tx.platformBillingAccount.update).not.toHaveBeenCalled();
    expect(tx.platformBillingAccount.updateMany).not.toHaveBeenCalled();
  });

  it('handles concurrent job runs with unique issue and outbox claims', async () => {
    const tx = state.transactions.conta_a!;
    const [first, second] = await Promise.all([
      expirePlatformBillingTrials({ now: NOW, environment: 'TEST' }),
      expirePlatformBillingTrials({ now: NOW, environment: 'TEST' }),
    ]);

    expect(first.detected + second.detected).toBe(2);
    expect(tx.platformBillingIssue.createMany).toHaveBeenCalledTimes(2);
    expect(tx.platformBillingAuditLog.create).toHaveBeenCalledOnce();
    expect(tx.platformBillingNotificationOutbox.createMany).toHaveBeenCalledTimes(2);
    expect(first.notificationQueued + second.notificationQueued).toBe(1);
    expect(state.queuedEvents).toEqual(new Set(['TEST:trial-expired:billing-a']));
    expect(tx.platformBillingAccount.update).not.toHaveBeenCalled();
    expect(tx.platformBillingAccount.updateMany).not.toHaveBeenCalled();
  });
});

const NOW = new Date('2030-01-02T00:00:00.000Z');

function makeAccount(contaId: string, id: string): TestAccount {
  return {
    id,
    contaId,
    planCode: 'BAND_001_025',
    stripeSubscriptionId: `sub_${id}`,
    trialEndsAt: new Date('2030-01-01T00:00:00.000Z'),
  };
}

function makeTenantTx(account: TestAccount): TestTenantTx {
  return {
    account,
    $queryRaw: vi.fn(async (): Promise<Array<{ id: string }>> => {
      state.lockReleased = new Promise<void>((resolve) => { state.releaseBillingLock = resolve; });
      return [{ id: account.id }];
    }),
    platformBillingAccount: {
      findMany: vi.fn(async (_args: Record<string, unknown>): Promise<TestAccount[]> => [account]),
      findFirst: vi.fn(async (_args: Record<string, unknown>): Promise<TestAccount | null> => (
        state.paidAccounts.has(account.id) ? null : account
      )),
      update: vi.fn(async (_args: Record<string, unknown>): Promise<unknown> => ({})),
      updateMany: vi.fn(async (_args: Record<string, unknown>): Promise<unknown> => ({})),
    },
    platformBillingIssue: {
      createMany: vi.fn(async ({ data }: { data: Array<{ fingerprint: string }> }): Promise<{ count: number }> => {
        const fingerprint = data[0]?.fingerprint;
        if (!fingerprint || state.claims.has(fingerprint)) return { count: 0 };
        state.claims.add(fingerprint);
        return { count: 1 };
      }),
      upsert: vi.fn(async (_args: Record<string, unknown>): Promise<unknown> => {
        state.issueStatus = 'OPEN';
        if (state.simulatePaymentWhileLocked && state.lockReleased) {
          state.pendingPayment = state.lockReleased.then(() => {
            state.paidAccounts.add(account.id);
            state.issueStatus = 'RESOLVED';
          });
        }
        return {};
      }),
    },
    platformBillingAuditLog: { create: vi.fn(async (_args: Record<string, unknown>): Promise<unknown> => ({})) },
    platformBillingNotificationOutbox: {
      createMany: vi.fn(async ({ data }: { data: Array<{ environment: string; eventId: string; eventType: string; contaId: string }> }): Promise<{ count: number }> => {
        const key = `${data[0]?.environment}:${data[0]?.eventId}`;
        if (!data[0] || state.queuedEvents.has(key)) return { count: 0 };
        state.queuedEvents.add(key);
        return { count: 1 };
      }),
    },
  };
}

function expiredUnpaidFilter() {
  return {
    status: { in: ['TRIALING', 'PAUSED', 'UNPAID', 'ACTIVE'] },
    trialEndsAt: { lte: NOW },
    firstPaidAt: null,
    lastSuccessfulPaymentAt: null,
  };
}
