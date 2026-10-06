import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({ financeReconciliationIssue: { findUnique: vi.fn(), upsert: vi.fn() } }));
const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
import { prisma } from '@alusa/database';
import { upsertFinanceReconciliationIssue } from './finance-reconciliation-issue.service';

const input = { contaId: 'conta-a', entityType: 'PAYMENT' as const, asaasId: 'pay-a', issueType: 'PAYMENT_NEEDS_REVIEW' as const, severity: 'MEDIUM' as const, causeId: 'event-a', metadata: { reason: 'unknown' } };

describe('finance reconciliation issue cause idempotency', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never) as never);
    vi.mocked(tx.financeReconciliationIssue.findUnique).mockResolvedValue(null as never);
    vi.mocked(tx.financeReconciliationIssue.upsert).mockResolvedValue({ id: 'issue-a' } as never);
  });

  it('does not reopen a resolved issue for a retry of the same provider cause', async () => {
    vi.mocked(tx.financeReconciliationIssue.findUnique).mockResolvedValue({ id: 'issue-a', status: 'RESOLVED', metadata: { lastCauseId: 'event-a' } } as never);
    await upsertFinanceReconciliationIssue(input);
    const update = vi.mocked(tx.financeReconciliationIssue.upsert).mock.calls[0]?.[0].update;
    expect(update).not.toHaveProperty('status');
    expect(update).not.toHaveProperty('resolvedAt');
  });

  it('reopens terminal issue for a distinct occurrence while keeping retries idempotent', async () => {
    vi.mocked(tx.financeReconciliationIssue.findUnique).mockResolvedValue({ id: 'issue-a', status: 'IGNORED', metadata: { lastCauseId: 'event-old' } } as never);
    await upsertFinanceReconciliationIssue({ ...input, causeId: 'event-new' });
    const update = vi.mocked(tx.financeReconciliationIssue.upsert).mock.calls[0]?.[0].update;
    expect(update).toMatchObject({ status: 'OPEN', resolvedAt: null, resolution: null });
    expect(update.metadata).toMatchObject({ lastCauseId: 'event-new' });
  });

  it('reopens a terminal issue for a fresh observation from callers without causeId', async () => {
    vi.mocked(tx.financeReconciliationIssue.findUnique).mockResolvedValue({ id: 'issue-a', status: 'RESOLVED', metadata: { lastCauseId: 'event-old' } } as never);
    await upsertFinanceReconciliationIssue({ ...input, causeId: undefined });
    const update = vi.mocked(tx.financeReconciliationIssue.upsert).mock.calls[0]?.[0].update;
    expect(update).toMatchObject({ status: 'OPEN', resolvedAt: null, resolution: null });
  });
});
