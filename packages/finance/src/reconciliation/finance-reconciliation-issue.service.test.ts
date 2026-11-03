import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({ financeReconciliationIssue: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() }, auditLog: { create: vi.fn() } }));
const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn(), financeReconciliationIssue: { updateMany: vi.fn() } }));
vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
import { prisma } from '@alusa/database';
import { resolveFinanceReconciliationIssueByDedupe, upsertFinanceReconciliationIssue } from './finance-reconciliation-issue.service';

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

  it('guards stale asynchronous resolution with tenant, open status, dedupe key, and observed version', async () => {
    const observedAt = new Date('2026-10-01T00:00:00.000Z');
    await resolveFinanceReconciliationIssueByDedupe({
      contaId: 'conta-a', dedupeKey: 'WEBHOOK_LAG:CHARGE:charge-a',
      resolution: 'Snapshot remoto consistente com estado local.', expectedLastSeenAt: observedAt,
    });
    expect(prisma.financeReconciliationIssue.updateMany).toHaveBeenCalledWith({
      where: { contaId: 'conta-a', dedupeKey: 'WEBHOOK_LAG:CHARGE:charge-a', status: 'OPEN', lastSeenAt: observedAt },
      data: { status: 'RESOLVED', resolvedAt: expect.any(Date), resolution: 'Snapshot remoto consistente com estado local.' },
    });
  });

  it('writes provider evidence audit atomically for automated issue resolution', async () => {
    vi.mocked(tx.financeReconciliationIssue.findFirst).mockResolvedValue({
      id: 'issue-lag', issueType: 'WEBHOOK_LAG', entityType: 'CHARGE', entityId: 'charge-a', asaasId: 'pay-a',
    } as never);
    vi.mocked(tx.financeReconciliationIssue.updateMany).mockResolvedValue({ count: 1 } as never);
    const observedAt = new Date('2026-10-01T00:00:00.000Z');
    await resolveFinanceReconciliationIssueByDedupe({
      contaId: 'conta-a', dedupeKey: 'WEBHOOK_LAG:CHARGE:charge-a',
      resolution: 'Snapshot do Asaas confirmou consistência.', expectedLastSeenAt: observedAt,
      auditMetadata: { paymentId: 'pay-a', remoteStatus: 'PENDING', localStatus: 'OPEN' },
    });
    expect(tx.financeReconciliationIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', dedupeKey: 'WEBHOOK_LAG:CHARGE:charge-a', status: 'OPEN', lastSeenAt: observedAt }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'conta-a', action: 'finance.reconciliation_issue.auto_resolved', entityId: 'issue-lag',
        metadata: expect.objectContaining({ providerEvidence: { paymentId: 'pay-a', remoteStatus: 'PENDING', localStatus: 'OPEN' } }),
      }),
    }));
  });

  it('does not audit or resolve when the compare-and-set sees a newer observation', async () => {
    vi.mocked(tx.financeReconciliationIssue.findFirst).mockResolvedValue({
      id: 'issue-lag', issueType: 'WEBHOOK_LAG', entityType: 'CHARGE', entityId: 'charge-a', asaasId: 'pay-a',
    } as never);
    vi.mocked(tx.financeReconciliationIssue.updateMany).mockResolvedValue({ count: 0 } as never);
    await resolveFinanceReconciliationIssueByDedupe({
      contaId: 'conta-a', dedupeKey: 'WEBHOOK_LAG:CHARGE:charge-a',
      resolution: 'Snapshot do Asaas confirmou consistência.', expectedLastSeenAt: new Date('2026-10-01T00:00:00.000Z'),
      auditMetadata: { paymentId: 'pay-a', remoteStatus: 'PENDING' },
    });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
