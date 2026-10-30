import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, tx, prisma } = vi.hoisted(() => {
  const snapshotCreateMany = vi.fn();
  const outboxCreateMany = vi.fn();
  const auditCreate = vi.fn();
  const issueUpsert = vi.fn();
  const tx = {
    platformBillingAccount: { findUnique: vi.fn() },
    platformBillingMonthlySnapshot: { createMany: snapshotCreateMany, findMany: vi.fn(), findUnique: vi.fn() },
    platformBillingAuditLog: { create: auditCreate },
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
    platformBillingIssue: { upsert: issueUpsert, findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    platformBillingNotificationOutbox: { createMany: outboxCreateMany },
  };
  const state = {
    studentCount: 501,
    tenantIds: [] as string[],
    snapshots: [] as Array<Record<string, unknown>>,
    historyMarkers: new Set<string>(),
  };
  return {
    state,
    tx,
    prisma: { conta: { count: vi.fn(), findMany: vi.fn() } },
  };
});

vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: (contaId: string, callback: (_client: unknown) => unknown) => {
    state.tenantIds.push(contaId);
    return callback(tx);
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/src/server/platform-billing/platform-billing-server', () => ({
  countActivePlatformBillingStudents: vi.fn(async () => state.studentCount),
  PlatformBillingHistoricalCountInconclusive: class PlatformBillingHistoricalCountInconclusive extends Error {},
  resolvePlatformBillingEnvironment: () => 'TEST',
}));
vi.mock('@/src/server/platform-billing/plan-change-actions', () => ({
  scheduleStablePlatformPriceBandTransition: vi.fn(),
}));
vi.mock('@/src/server/platform-billing/custom-quantity-sync', () => ({
  syncCustomSubscriptionQuantityForMonthlyClose: vi.fn(async () => []),
}));

import { capturePlatformBillingMonthlySnapshots } from '@/src/server/platform-billing/monthly-snapshots';
import { countActivePlatformBillingStudents, PlatformBillingHistoricalCountInconclusive } from '@/src/server/platform-billing/platform-billing-server';
import { scheduleStablePlatformPriceBandTransition } from '@/src/server/platform-billing/plan-change-actions';

describe('capturePlatformBillingMonthlySnapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.studentCount = 501;
    state.tenantIds = [];
    state.snapshots = [];
    state.historyMarkers = new Set();
    vi.mocked(prisma.conta.count).mockResolvedValue(1);
    vi.mocked(prisma.conta.findMany).mockResolvedValue([{ id: 'conta_1', timezone: 'UTC' }] as never);
    vi.mocked(tx.platformBillingAccount.findUnique).mockResolvedValue({ id: 'billing_account_1', planCode: 'STARTER' } as never);
    vi.mocked(tx.platformBillingMonthlySnapshot.findMany).mockResolvedValue([
      { periodStart: new Date('2026-10-01T00:00:00Z'), candidateBand: 'SPECIALIST' },
      { periodStart: new Date('2026-09-01T00:00:00Z'), candidateBand: 'SPECIALIST' },
      { periodStart: new Date('2026-08-01T00:00:00Z'), candidateBand: 'SPECIALIST' },
    ] as never);
    vi.mocked(tx.platformBillingMonthlySnapshot.findUnique).mockResolvedValue(null as never);
    vi.mocked(tx.platformBillingIssue.upsert).mockResolvedValue({} as never);
    vi.mocked(tx.platformBillingIssue.findUnique).mockResolvedValue(null as never);
    vi.mocked(tx.platformBillingIssue.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(tx.platformBillingIssue.findMany).mockResolvedValue([] as never);
    vi.mocked(tx.auditLog.findFirst).mockImplementation(async ({ where }) =>
      state.historyMarkers.has(where.contaId) ? { id: 'history-marker' } as never : null as never,
    );
    vi.mocked(tx.auditLog.create).mockImplementation(async ({ data }) => {
      state.historyMarkers.add(data.contaId);
      return {} as never;
    });
  });

  it('opens one internal issue and one school notice after three specialist closes without repricing', async () => {
    const now = new Date('2026-11-01T00:00:00Z');
    let persistedIssue: Record<string, unknown> | null = null;
    const persistedNotices = new Set<string>();
    vi.mocked(tx.platformBillingMonthlySnapshot.createMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    vi.mocked(tx.platformBillingIssue.upsert).mockImplementation(async ({ create, update }) => {
      if (!persistedIssue) persistedIssue = { ...create };
      else Object.assign(persistedIssue, update);
      return persistedIssue as never;
    });
    vi.mocked(tx.platformBillingNotificationOutbox.createMany).mockImplementation(async ({ data }) => {
      let count = 0;
      for (const notice of data) {
        const key = `${notice.environment}:${notice.eventId}`;
        if (!persistedNotices.has(key)) {
          persistedNotices.add(key);
          count += 1;
        }
      }
      return { count } as never;
    });

    const first = await capturePlatformBillingMonthlySnapshots({ prisma: prisma as never, now });
    const issueAtFirstNotice = structuredClone(persistedIssue);
    const afterTransitionWindow = await capturePlatformBillingMonthlySnapshots({
      prisma: prisma as never,
      now: new Date('2026-12-01T12:00:00Z'),
    });

    expect(first).toMatchObject({ readyForSpecialist: 1, specialistNoticesCreated: 1, transitionsScheduled: 0 });
    expect(afterTransitionWindow).toMatchObject({ readyForSpecialist: 1, specialistNoticesCreated: 0, transitionsScheduled: 0 });
    expect(tx.platformBillingIssue.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      create: expect.objectContaining({
        code: 'SPECIALIST_NEGOTIATION_REQUIRED',
        details: expect.objectContaining({
          noticeAt: now.toISOString(),
          transitionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          automaticPricing: false,
        }),
      }),
      update: {},
    }));
    expect(persistedIssue).toEqual(issueAtFirstNotice);
    expect(persistedIssue?.details).toMatchObject({
      noticeAt: now.toISOString(),
      transitionEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(persistedNotices.size).toBe(1);
    expect(tx.platformBillingNotificationOutbox.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ eventType: 'platform.specialist_negotiation_ready', contaId: 'conta_1' })],
      skipDuplicates: true,
    }));
    expect(tx.platformBillingAuditLog.create).toHaveBeenCalledTimes(2);
    expect(scheduleStablePlatformPriceBandTransition).not.toHaveBeenCalled();
  });

  it('schedules a self-service transition only on the third consecutive persisted close and rejects a month gap', async () => {
    state.studentCount = 30;
    vi.mocked(scheduleStablePlatformPriceBandTransition).mockResolvedValue('scheduled');
    vi.mocked(tx.platformBillingAccount.findUnique).mockResolvedValue({ id: 'billing_account_1', planCode: 'BAND_001_025' } as never);
    vi.mocked(tx.platformBillingMonthlySnapshot.createMany).mockImplementation(async ({ data }) => {
      const record = data[0] as Record<string, unknown>;
      if (!state.snapshots.some((snapshot) => snapshot.periodStart === record.periodStart)) state.snapshots.push(record);
      return { count: 1 } as never;
    });
    vi.mocked(tx.platformBillingMonthlySnapshot.findMany).mockImplementation(async () =>
      [...state.snapshots].sort((left, right) =>
        new Date(String(right.periodStart)).getTime() - new Date(String(left.periodStart)).getTime(),
      ).slice(0, 3) as never,
    );

    for (const [now, expectedTransitions] of [
      ['2026-11-01T12:00:00Z', 0],
      ['2026-12-01T12:00:00Z', 0],
      ['2027-01-01T12:00:00Z', 1],
    ] as const) {
      const result = await capturePlatformBillingMonthlySnapshots({ prisma: prisma as never, now: new Date(now) });
      expect(result.transitionsScheduled).toBe(expectedTransitions);
    }
    expect(scheduleStablePlatformPriceBandTransition).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    state.snapshots = [];
    vi.mocked(prisma.conta.findMany).mockResolvedValue([{ id: 'conta_gap', timezone: 'UTC' }] as never);
    vi.mocked(tx.platformBillingAccount.findUnique).mockResolvedValue({ id: 'billing_account_gap', planCode: 'BAND_001_025' } as never);
    for (const now of ['2026-11-01T12:00:00Z', '2027-01-01T12:00:00Z', '2027-02-01T12:00:00Z']) {
      const result = await capturePlatformBillingMonthlySnapshots({ prisma: prisma as never, now: new Date(now) });
      expect(result.transitionsScheduled).toBe(0);
    }
    expect(scheduleStablePlatformPriceBandTransition).not.toHaveBeenCalled();
  });

  it('keeps snapshot, issue and notification writes scoped to each Conta', async () => {
    vi.mocked(prisma.conta.findMany).mockResolvedValue([
      { id: 'conta_a', timezone: 'UTC' },
      { id: 'conta_b', timezone: 'UTC' },
    ] as never);
    vi.mocked(tx.platformBillingAccount.findUnique).mockImplementation(async ({ where }) => ({
      id: `account-${where.uq_platform_billing_account_conta_env.contaId}`,
      planCode: 'STARTER',
    }) as never);
    vi.mocked(tx.platformBillingMonthlySnapshot.createMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(tx.platformBillingNotificationOutbox.createMany).mockResolvedValue({ count: 1 } as never);

    await capturePlatformBillingMonthlySnapshots({ prisma: prisma as never, now: new Date('2026-11-01T12:00:00Z') });

    expect(new Set(state.tenantIds)).toEqual(new Set(['conta_a', 'conta_b']));
    expect(tx.platformBillingMonthlySnapshot.createMany.mock.calls.flatMap(([args]) => args.data.map((row) => [row.contaId, row.billingAccountId])))
      .toEqual([['conta_a', 'account-conta_a'], ['conta_b', 'account-conta_b']]);
    expect(tx.platformBillingIssue.upsert.mock.calls.map(([args]) => args.create.contaId)).toEqual(['conta_a', 'conta_b']);
    expect(tx.platformBillingNotificationOutbox.createMany.mock.calls.flatMap(([args]) => args.data.map((row) => row.contaId)))
      .toEqual(['conta_a', 'conta_b']);
  });

  it('processes one bounded page and rotates to every active account across cron intervals', async () => {
    const accounts = ['conta_a', 'conta_b', 'conta_c', 'conta_d'].map((id) => ({ id, timezone: 'UTC' }));
    vi.mocked(prisma.conta.count).mockResolvedValue(accounts.length);
    vi.mocked(prisma.conta.findMany).mockImplementation(async ({ skip, take }) =>
      accounts.slice(skip, skip + take) as never,
    );
    vi.mocked(tx.platformBillingMonthlySnapshot.createMany).mockResolvedValue({ count: 0 } as never);

    const first = await capturePlatformBillingMonthlySnapshots({
      prisma: prisma as never,
      now: new Date('2026-11-01T12:00:00Z'),
      limit: 2,
    });
    const firstPage = [...state.tenantIds];
    state.tenantIds = [];
    const second = await capturePlatformBillingMonthlySnapshots({
      prisma: prisma as never,
      now: new Date('2026-11-01T12:05:00Z'),
      limit: 2,
    });

    expect(first.checked).toBe(2);
    expect(second.checked).toBe(2);
    expect(new Set(firstPage)).toHaveLength(2);
    expect(new Set(state.tenantIds)).toHaveLength(2);
    expect(new Set([...firstPage, ...state.tenantIds])).toEqual(new Set(accounts.map(({ id }) => id)));
    expect(prisma.conta.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 2, skip: expect.any(Number) }),
    );
    expect(prisma.conta.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ take: 2, skip: expect.any(Number) }),
    );
  });

  it('records a missed close as inconclusive instead of inventing a historical count', async () => {
    vi.mocked(countActivePlatformBillingStudents).mockRejectedValue(new PlatformBillingHistoricalCountInconclusive());
    const result = await capturePlatformBillingMonthlySnapshots({
      prisma: prisma as never,
      now: new Date('2026-11-02T12:00:00Z'),
    });

    expect(result).toMatchObject({ checked: 1, captured: 0, recovered: 0 });
    expect(tx.platformBillingMonthlySnapshot.createMany).not.toHaveBeenCalled();
    expect(tx.platformBillingIssue.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        code: 'MONTHLY_CLOSE_INCONCLUSIVE',
        status: 'OPEN',
        details: expect.objectContaining({ reason: 'MISSED_CLOSE_WINDOW', automaticPricing: false }),
      }),
    }));
  });

  it('distinguishes known historical uncertainty from operational failures and reopens a resolved issue', async () => {
    vi.mocked(tx.platformBillingIssue.findUnique).mockResolvedValue({
      id: 'issue-1', status: 'RESOLVED', details: { reason: 'OLDER_REASON' },
    } as never);
    vi.mocked(countActivePlatformBillingStudents)
      .mockRejectedValueOnce(new PlatformBillingHistoricalCountInconclusive())
      .mockRejectedValueOnce(new Error('database unavailable'));
    await capturePlatformBillingMonthlySnapshots({ prisma: prisma as never, now: new Date('2026-11-01T12:00:00Z') });
    await capturePlatformBillingMonthlySnapshots({ prisma: prisma as never, now: new Date('2026-11-01T12:05:00Z') });
    const inconclusiveUpdates = tx.platformBillingIssue.upsert.mock.calls
      .map(([args]) => args)
      .filter((args) => args.create.code === 'MONTHLY_CLOSE_INCONCLUSIVE')
      .map((args) => args.update);
    expect(inconclusiveUpdates).toEqual([
      expect.objectContaining({ status: 'OPEN', resolvedAt: null, details: expect.objectContaining({ reason: 'HISTORICAL_DATA_INSUFFICIENT' }) }),
      expect.objectContaining({ status: 'OPEN', resolvedAt: null, details: expect.objectContaining({ reason: 'CLOSE_PROCESSING_FAILED' }) }),
    ]);
  });

  it('resolves an inconclusive issue idempotently when its exact snapshot already exists', async () => {
    const historicalError = new (PlatformBillingHistoricalCountInconclusive as unknown as new () => Error)();
    vi.mocked(countActivePlatformBillingStudents)
      .mockRejectedValueOnce(historicalError)
      .mockResolvedValueOnce(42);
    vi.mocked(tx.platformBillingIssue.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'issue-close', contaId: 'conta_1', status: 'OPEN' } as never);
    vi.mocked(tx.platformBillingMonthlySnapshot.createMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    vi.mocked(tx.platformBillingMonthlySnapshot.findUnique).mockResolvedValue({ id: 'snapshot-october' } as never);
    vi.mocked(tx.platformBillingIssue.findMany).mockResolvedValue([
      { id: 'issue-close', fingerprint: 'TEST:conta_1:monthly-close-inconclusive:2026-10-01', details: {} },
    ] as never);

    const failed = await capturePlatformBillingMonthlySnapshots({ prisma: prisma as never, now: new Date('2026-11-01T12:00:00Z') });
    const recovered = await capturePlatformBillingMonthlySnapshots({ prisma: prisma as never, now: new Date('2026-11-01T12:05:00Z') });

    expect(failed.inconclusive).toBe(1);
    expect(recovered).toMatchObject({ inconclusive: 0, recovered: 1, captured: 1 });
    expect(tx.platformBillingMonthlySnapshot.createMany).toHaveBeenCalledTimes(1);
    expect(tx.platformBillingIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'issue-close', contaId: 'conta_1', environment: 'TEST', status: 'OPEN' }),
      data: expect.objectContaining({ status: 'RESOLVED', resolvedAt: expect.any(Date) }),
    }));
    expect(tx.platformBillingAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'PLATFORM_BILLING_MONTHLY_CLOSE_ISSUE_RESOLVED',
        entityId: 'TEST:conta_1:monthly-close-inconclusive:2026-10-01',
      }),
    }));
  });
});
