import { describe, expect, it, vi } from 'vitest';
import type { StripeSubscriptionQuantityState } from '@alusa/stripe';
import { syncCustomSubscriptionQuantityForMonthlyClose } from './custom-quantity-sync';

function makeHarness(options: { periods?: string[]; priceId?: string; includeForeignTenantSnapshot?: boolean } = {}) {
  const contaId = 'tenant_a';
  const environment = 'TEST' as const;
  const periods = options.periods ?? ['2026-10-01'];
  const snapshots = periods.map((start, index) => ({
    id: `snapshot_${index + 1}`, contaId, environment, periodStart: new Date(`${start}T00:00:00.000Z`), studentCount: index === 0 ? 44 : 51,
    customQuantitySyncStatus: index < periods.length - 1 ? 'PENDING' as string : null,
    customQuantitySyncRequestedQuantity: index < periods.length - 1 ? 44 : null,
    customQuantitySyncOperationKey: index < periods.length - 1 ? `old-operation-${index}` : null,
    customQuantitySyncStripeSubscriptionId: index < periods.length - 1 ? 'sub_a' : null,
    customQuantitySyncStripeSubscriptionItemId: null as string | null,
    customQuantitySyncPriceId: index < periods.length - 1 ? options.priceId ?? 'price_custom' : null,
    customQuantitySyncAttemptCount: 0,
    customQuantitySyncLastAttemptAt: null as Date | null,
    customQuantitySyncLastErrorCode: null as string | null,
    customQuantitySyncAppliedAt: null as Date | null,
  }));
  const foreignSnapshot = options.includeForeignTenantSnapshot ? {
    id: 'snapshot_tenant_b', contaId: 'tenant_b', environment,
    periodStart: new Date(`${periods.at(-1)}T00:00:00.000Z`), studentCount: 88,
    customQuantitySyncStatus: 'PENDING' as string, customQuantitySyncRequestedQuantity: 88,
    customQuantitySyncOperationKey: 'tenant-b-operation', customQuantitySyncStripeSubscriptionId: 'sub_b',
    customQuantitySyncStripeSubscriptionItemId: null as string | null, customQuantitySyncPriceId: 'price_b',
    customQuantitySyncAttemptCount: 0, customQuantitySyncLastAttemptAt: null as Date | null,
    customQuantitySyncLastErrorCode: null as string | null, customQuantitySyncAppliedAt: null as Date | null,
  } : null;
  if (foreignSnapshot) snapshots.push(foreignSnapshot);
  const audits: Array<Record<string, unknown>> = [];
  const issues: Array<Record<string, unknown>> = [];
  const account = { id: 'billing_a', planCode: 'CUSTOM', status: 'ACTIVE', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: options.priceId ?? 'price_custom' };
  const invitation = { id: 'invitation_a', conditionType: 'CUSTOM', stripeProductId: 'prod_a', stripePriceId: options.priceId ?? 'price_custom' };
  function matchesStatus(row: (typeof snapshots)[number], condition: unknown): boolean {
    if (condition === undefined) return true;
    if (condition === null || typeof condition === 'string') return row.customQuantitySyncStatus === condition;
    if (typeof condition === 'object' && condition !== null && 'in' in condition) return (condition as { in: string[] }).in.includes(row.customQuantitySyncStatus ?? '');
    return true;
  }
  const tx = {
    platformBillingMonthlySnapshot: {
      findUnique: vi.fn(async ({ where }: { where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId: string; environment: string; periodStart: Date } } }) => snapshots.find((row) => row.contaId === where.uq_platform_billing_monthly_snapshot_conta_env_period.contaId && row.environment === where.uq_platform_billing_monthly_snapshot_conta_env_period.environment && row.periodStart.getTime() === where.uq_platform_billing_monthly_snapshot_conta_env_period.periodStart.getTime()) ?? null),
      findFirst: vi.fn(async ({ where, orderBy }: { where?: { contaId?: string; environment?: string }; orderBy?: { periodStart: 'desc' } }) => [...snapshots].filter((row) => (!where?.contaId || row.contaId === where.contaId) && (!where?.environment || row.environment === where.environment)).sort((a, b) => orderBy?.periodStart === 'desc' ? b.periodStart.getTime() - a.periodStart.getTime() : a.periodStart.getTime() - b.periodStart.getTime())[0] ?? null),
      findMany: vi.fn(async ({ where }: { where: { contaId?: string; environment?: string; customQuantitySyncStatus?: unknown } }) => snapshots.filter((row) => (!where.contaId || row.contaId === where.contaId) && (!where.environment || row.environment === where.environment) && matchesStatus(row, where.customQuantitySyncStatus)).sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; contaId?: string; environment?: string; customQuantitySyncStatus?: unknown; customQuantitySyncLastAttemptAt?: { lt: Date }; OR?: Array<{ customQuantitySyncLastAttemptAt: null | { lt: Date } }> }; data: Record<string, unknown> }) => {
        const row = snapshots.find((candidate) => candidate.id === where.id && (!where.contaId || candidate.contaId === where.contaId) && (!where.environment || candidate.environment === where.environment));
        if (!row || !matchesStatus(row, where.customQuantitySyncStatus)) return { count: 0 };
        if (where.customQuantitySyncLastAttemptAt && (!row.customQuantitySyncLastAttemptAt || row.customQuantitySyncLastAttemptAt >= where.customQuantitySyncLastAttemptAt.lt)) return { count: 0 };
        if (where.OR) {
          const eligible = where.OR.some((condition) => condition.customQuantitySyncLastAttemptAt === null
            ? row.customQuantitySyncLastAttemptAt === null
            : Boolean(row.customQuantitySyncLastAttemptAt && row.customQuantitySyncLastAttemptAt < condition.customQuantitySyncLastAttemptAt.lt));
          if (!eligible) return { count: 0 };
        }
        for (const [key, value] of Object.entries(data)) {
          if (key === 'customQuantitySyncAttemptCount' && typeof value === 'object' && value !== null && 'increment' in value) {
            row.customQuantitySyncAttemptCount += Number((value as { increment: number }).increment);
          } else Object.assign(row, { [key]: value });
        }
        return { count: 1 };
      }),
    },
    platformBillingAccount: { findUnique: vi.fn(async () => account) },
    platformSchoolInvitation: { findFirst: vi.fn(async () => invitation) },
    platformBillingAuditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return { id: `audit_${audits.length}` }; }) },
    platformBillingIssue: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => { issues.push(create); return create; }),
      updateMany: vi.fn(async () => ({ count: issues.length ? 1 : 0 })),
    },
  };
  const runTenant = vi.fn(async (tenant: string, callback: (client: typeof tx) => unknown) => {
    if (tenant !== contaId) throw new Error('cross-tenant access');
    return callback(tx);
  });
  const periodStart = snapshots.at(-1)!.periodStart;
  return { contaId, environment, snapshots, audits, issues, account, invitation, tx, runTenant, periodStart };
}

function stripeState(input: { quantity?: number; priceId?: string; itemPeriod?: string } = {}): StripeSubscriptionQuantityState {
  return {
    id: 'sub_a', customerId: 'cus_a', status: 'active' as const, livemode: false,
    metadata: { invitationId: 'invitation_a', conditionType: 'custom' }, itemsComplete: true,
    items: [{ id: 'si_a', priceId: input.priceId ?? 'price_custom', quantity: input.quantity ?? 1, metadata: input.itemPeriod ? { alusaQuantitySyncPeriod: input.itemPeriod } : {} }],
  };
}

const fixedNow = new Date('2026-11-01T12:00:00.000Z');

describe('custom subscription monthly quantity sync', () => {
  it('retries an ambiguous timeout with the same persisted Stripe idempotency key', async () => {
    const h = makeHarness();
    const retrieve = vi.fn(async (_subscriptionId: string) => stripeState());
    const update = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValueOnce({ id: 'si_a', quantity: 44 });
    const input = { contaId: h.contaId, environment: h.environment, periodStart: h.periodStart, now: fixedNow, runTenant: h.runTenant as never, retrieve, update };

    await expect(syncCustomSubscriptionQuantityForMonthlyClose(input)).resolves.toEqual([{ status: 'UNKNOWN', changed: true }]);
    const key = h.snapshots[0]!.customQuantitySyncOperationKey;
    expect(h.snapshots[0]).toMatchObject({ customQuantitySyncStatus: 'UNKNOWN', customQuantitySyncRequestedQuantity: 44, customQuantitySyncAttemptCount: 1 });
    await expect(syncCustomSubscriptionQuantityForMonthlyClose({ ...input, now: new Date(fixedNow.getTime() + 60_000) })).resolves.toEqual([{ status: 'SUCCEEDED', changed: true }]);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ quantity: 44, operationPeriod: '2026-10', idempotencyKey: key });
    expect(update.mock.calls[1]?.[0]).toEqual(update.mock.calls[0]?.[0]);
    expect(h.snapshots[0]?.customQuantitySyncStatus).toBe('SUCCEEDED');
    expect(h.issues).toHaveLength(0);
    expect(h.runTenant).toHaveBeenCalledWith('tenant_a', expect.any(Function));
  });

  it('claims one operation under concurrent maintenance calls and cannot revert to an older pending count', async () => {
    const h = makeHarness({ periods: ['2026-10-01', '2026-11-01'] });
    let releaseRetrieve!: () => void;
    const gate = new Promise<void>((resolve) => { releaseRetrieve = resolve; });
    const retrieve = vi.fn(async (_subscriptionId: string) => { await gate; return stripeState(); });
    const update = vi.fn(async (_input: { subscriptionItemId: string; quantity: number; operationPeriod: string; idempotencyKey: string }) => ({ id: 'si_a', quantity: 51 }));
    const input = { contaId: h.contaId, environment: h.environment, periodStart: h.periodStart, now: fixedNow, runTenant: h.runTenant as never, retrieve, update };
    const first = syncCustomSubscriptionQuantityForMonthlyClose(input);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(retrieve).toHaveBeenCalledTimes(1);
    const concurrent = await syncCustomSubscriptionQuantityForMonthlyClose(input);
    expect(concurrent).toEqual([{ status: 'BUSY', changed: false }]);
    releaseRetrieve();
    await expect(first).resolves.toContainEqual({ status: 'SUCCEEDED', changed: true });

    expect(h.snapshots[0]?.customQuantitySyncStatus).toBe('SUPERSEDED');
    expect(h.snapshots[1]).toMatchObject({ customQuantitySyncStatus: 'SUCCEEDED', customQuantitySyncRequestedQuantity: 51 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ quantity: 51, operationPeriod: '2026-11' });
  });

  it('processes Conta A monthly sync without reading or changing Conta B snapshot/subscription', async () => {
    const h = makeHarness({ includeForeignTenantSnapshot: true });
    const foreignSnapshotBefore = structuredClone(h.snapshots.find((row) => row.contaId === 'tenant_b'));
    let remoteTenantBQuantity = 88;
    const retrieve = vi.fn(async (subscriptionId: string) => {
      if (subscriptionId === 'sub_b') return stripeState({ quantity: remoteTenantBQuantity, priceId: 'price_b' });
      return stripeState({ quantity: 20, priceId: 'price_custom' });
    });
    const update = vi.fn(async (input: { subscriptionItemId: string; quantity: number; operationPeriod: string; idempotencyKey: string }) => {
      if (input.subscriptionItemId === 'si_b') remoteTenantBQuantity = input.quantity;
      return { id: 'si_a', quantity: input.quantity };
    });

    await expect(syncCustomSubscriptionQuantityForMonthlyClose({
      contaId: h.contaId, environment: h.environment, periodStart: h.periodStart, now: fixedNow,
      runTenant: h.runTenant as never, retrieve, update,
    })).resolves.toEqual([{ status: 'SUCCEEDED', changed: true }]);

    expect(h.snapshots.find((row) => row.contaId === 'tenant_b')).toEqual(foreignSnapshotBefore);
    expect(remoteTenantBQuantity).toBe(88);
    expect(retrieve).toHaveBeenCalledWith('sub_a');
    expect(retrieve).not.toHaveBeenCalledWith('sub_b');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ subscriptionItemId: 'si_a', quantity: 44 }));
    expect(h.runTenant.mock.calls.every(([tenant]) => tenant === 'tenant_a')).toBe(true);
  });

  it('blocks Price mismatch, creates a support issue, and never updates a different subscription item', async () => {
    const h = makeHarness();
    const retrieve = vi.fn(async (_subscriptionId: string) => stripeState({ priceId: 'price_other' }));
    const update = vi.fn(async (_input: { subscriptionItemId: string; quantity: number; operationPeriod: string; idempotencyKey: string }) => ({ id: 'si_a', quantity: 44 }));
    await expect(syncCustomSubscriptionQuantityForMonthlyClose({
      contaId: h.contaId, environment: h.environment, periodStart: h.periodStart, now: fixedNow,
      runTenant: h.runTenant as never, retrieve, update,
    })).resolves.toEqual([{ status: 'BLOCKED', changed: true }]);

    expect(update).not.toHaveBeenCalled();
    expect(h.snapshots[0]).toMatchObject({ customQuantitySyncStatus: 'BLOCKED', customQuantitySyncLastErrorCode: 'STRIPE_SUBSCRIPTION_PRICE_OR_TENANT_MISMATCH' });
    expect(h.issues).toHaveLength(1);
    expect(h.issues[0]).toMatchObject({ code: 'CUSTOM_SUBSCRIPTION_QUANTITY_SYNC_BLOCKED', contaId: 'tenant_a' });
  });

  it('retries a blocked operation hourly after binding repair and resolves its support issue with audit', async () => {
    const h = makeHarness();
    const retrieve = vi.fn(async (_subscriptionId: string) => stripeState())
      .mockResolvedValueOnce(stripeState({ priceId: 'price_other' }))
      .mockResolvedValueOnce(stripeState());
    const update = vi.fn(async (_input: { subscriptionItemId: string; quantity: number; operationPeriod: string; idempotencyKey: string }) => ({ id: 'si_a', quantity: 44 }));
    const input = { contaId: h.contaId, environment: h.environment, periodStart: h.periodStart, now: fixedNow, runTenant: h.runTenant as never, retrieve, update };

    await expect(syncCustomSubscriptionQuantityForMonthlyClose(input)).resolves.toEqual([{ status: 'BLOCKED', changed: true }]);
    await expect(syncCustomSubscriptionQuantityForMonthlyClose({ ...input, now: new Date(fixedNow.getTime() + 60 * 60_000 + 1) }))
      .resolves.toEqual([{ status: 'SUCCEEDED', changed: true }]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(h.tx.platformBillingIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'OPEN', fingerprint: expect.stringContaining('custom-subscription-quantity-sync') }),
      data: expect.objectContaining({ status: 'RESOLVED' }),
    }));
    expect(h.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'CUSTOM_QUANTITY_SYNC_BLOCKED_ISSUE_RESOLVED' }),
    ]));
  });

  it('recognizes a timeout that already applied remotely without creating another provider resource', async () => {
    const h = makeHarness();
    const retrieve = vi.fn(async (_subscriptionId: string) => stripeState())
      .mockResolvedValueOnce(stripeState())
      .mockResolvedValueOnce(stripeState({ quantity: 44, itemPeriod: '2026-10' }));
    const update = vi.fn(async (_input: { subscriptionItemId: string; quantity: number; operationPeriod: string; idempotencyKey: string }) => ({ id: 'si_a', quantity: 44 }))
      .mockRejectedValueOnce(Object.assign(new Error('network timeout'), { code: 'ETIMEDOUT' }));
    const input = { contaId: h.contaId, environment: h.environment, periodStart: h.periodStart, now: fixedNow, runTenant: h.runTenant as never, retrieve, update };
    await syncCustomSubscriptionQuantityForMonthlyClose(input);
    await expect(syncCustomSubscriptionQuantityForMonthlyClose({ ...input, now: new Date(fixedNow.getTime() + 60_000) })).resolves.toEqual([{ status: 'SUCCEEDED', changed: true }]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(h.snapshots[0]?.customQuantitySyncAttemptCount).toBe(2);
  });
});
