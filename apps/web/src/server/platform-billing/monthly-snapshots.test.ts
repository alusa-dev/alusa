import { describe, expect, it, vi } from 'vitest';

const runWithTenantMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: runWithTenantMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/observability/api-logger', () => ({ logApiOperationalEvent: vi.fn() }));
vi.mock('./platform-billing-server', () => ({
  countActivePlatformBillingStudents: vi.fn(),
  PlatformBillingHistoricalCountInconclusive: class extends Error {},
  resolvePlatformBillingEnvironment: () => 'TEST',
}));
vi.mock('./plan-change-actions', () => ({ scheduleStablePlatformPriceBandTransition: vi.fn() }));

import { canResolveMonthlyCloseIssue, capturePlatformBillingMonthlySnapshots } from './monthly-snapshots';

describe('monthly close issue resolution', () => {
  it('resolves only the exact competence after it has been captured', () => {
    const fingerprint = 'TEST:conta-a:monthly-close-inconclusive:2026-09-01';
    expect(canResolveMonthlyCloseIssue(fingerprint, 'TEST', 'conta-a', '2026-09-01')).toBe(true);
    expect(canResolveMonthlyCloseIssue(fingerprint, 'TEST', 'conta-a', '2026-10-01')).toBe(false);
    expect(canResolveMonthlyCloseIssue(fingerprint, 'TEST', 'conta-b', '2026-09-01')).toBe(false);
    expect(canResolveMonthlyCloseIssue(fingerprint, 'LIVE', 'conta-a', '2026-09-01')).toBe(false);
    expect(canResolveMonthlyCloseIssue('malformed', 'TEST', 'conta-a', '2026-09-01')).toBe(false);
  });

  it('does not enumerate pre-billing tenants for monthly closes', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { conta: { count, findMany } };

    await expect(capturePlatformBillingMonthlySnapshots({
      prisma: prisma as never,
      environment: 'TEST',
      now: new Date('2026-11-01T12:00:00.000Z'),
    })).resolves.toMatchObject({ checked: 0, inconclusive: 0 });

    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ platformBillingAccounts: { some: { environment: 'TEST' } } }),
    }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ platformBillingAccounts: { some: { environment: 'TEST' } } }),
    }));
  });

  it('does not flag a missed competence before the billing account existed', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'conta-new', timezone: 'America/Manaus' }]);
    const issueUpsert = vi.fn();
    const tx = {
      platformBillingAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'billing-new', createdAt: new Date('2026-11-01T05:00:00.000Z') }) },
      platformBillingIssue: { upsert: issueUpsert },
    };
    runWithTenantMock.mockImplementation(async (_contaId: string, callback: (_input: typeof tx) => unknown) => callback(tx));

    await expect(capturePlatformBillingMonthlySnapshots({
      prisma: { conta: { count: vi.fn().mockResolvedValue(1), findMany } } as never,
      environment: 'TEST',
      now: new Date('2026-11-01T12:00:00.000Z'),
    })).resolves.toMatchObject({ checked: 1, captured: 0, inconclusive: 0 });

    expect(issueUpsert).not.toHaveBeenCalled();
  });
});
