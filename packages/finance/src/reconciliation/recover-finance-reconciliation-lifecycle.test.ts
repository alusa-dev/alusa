import { describe, expect, it, vi, beforeEach } from 'vitest';

const { prisma, tx, getPayment, getSubscription, auditCreate, issueUpdate } = vi.hoisted(() => {
  const auditCreate = vi.fn();
  const issueUpdate = vi.fn();
  const model = () => ({ findFirst: vi.fn().mockResolvedValue(null) });
  const tx = {
    charge: model(), cobranca: model(), pagamento: model(), subscription: model(),
    standaloneSubscription: model(), billingAgreement: model(), matricula: model(),
    enrollmentCreationOperation: model(), acordoFinanceiroFuturo: model(),
    financeReconciliationIssue: { updateMany: issueUpdate },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    charge: model(), cobranca: model(), pagamento: model(), subscription: model(),
    standaloneSubscription: model(), billingAgreement: model(), matricula: model(),
    enrollmentCreationOperation: model(), acordoFinanceiroFuturo: model(),
    financeReconciliationIssue: { findFirst: vi.fn() },
    asaasResourceOrigin: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx, getPayment: vi.fn(), getSubscription: vi.fn(), auditCreate, issueUpdate };
});

vi.mock('@alusa/database', () => ({ prisma, loadAsaasCredentials: vi.fn() }));
vi.mock('../../../../packages/asaas/src', () => ({ getPayment, getSubscription, listPayments: vi.fn() }));
vi.mock('./asaas-resource-origin.service', () => ({
  classifyPreviewedExternalSubscription: vi.fn(), previewExternalSubscriptionCandidates: vi.fn(),
}));
vi.mock('../foundation/webhook-job-lock.service', () => ({
  acquireWebhookJobLock: vi.fn(), releaseWebhookJobLock: vi.fn(), renewWebhookJobLock: vi.fn(),
}));
vi.mock('../webhooks/webhook-reconciliation.service', () => ({ reconcileWithAsaas: vi.fn() }));
vi.mock('../use-cases/asaas-pagination', () => ({ assertCompleteAsaasPage: vi.fn() }));

import {
  resolveExternalChildReview,
  resolveAbsentTerminalLagIssue,
  resolveAlreadyLinkedPaymentIssue,
  resolveHistoricalPayment,
} from '../../../../scripts/recover-finance-reconciliation-lifecycle';

describe('finance recovery lifecycle race guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const row of [tx.charge, tx.cobranca, tx.pagamento, tx.subscription, tx.standaloneSubscription,
      tx.billingAgreement, tx.matricula, tx.enrollmentCreationOperation, tx.acordoFinanceiroFuturo,
      prisma.charge, prisma.cobranca, prisma.pagamento, prisma.subscription, prisma.standaloneSubscription,
      prisma.billingAgreement, prisma.matricula, prisma.enrollmentCreationOperation, prisma.acordoFinanceiroFuturo]) {
      vi.mocked(row.findFirst).mockResolvedValue(null);
    }
  });

  it.each([false, true])('validates legacy child proof without financial writes (ambiguous=%s)', async (ambiguous) => {
    const evidence = { issueId: 'issue-child', paymentId: 'pay-child', subscriptionIds: ['sub-reviewed'], descriptions: [], externalReferences: [] };
    vi.mocked(prisma.financeReconciliationIssue.findFirst).mockResolvedValue({
      id: evidence.issueId, contaId: 'tenant-reviewed', issueType: 'PAYMENT_NEEDS_REVIEW', entityType: 'PAYMENT',
      asaasId: evidence.paymentId, status: 'OPEN', metadata: {
        reason: 'resource_origin_unknown', event: 'PAYMENT_RECEIVED', lastCauseId: 'evt-[REDACTED]',
      },
    });
    const row = {
      contaId: 'tenant-reviewed', eventId: 'evt-canonical', event: 'PAYMENT_RECEIVED', paymentId: 'pay-child',
      payloadId: 'evt-[REDACTED]', payloadEvent: 'PAYMENT_RECEIVED', payloadPaymentId: 'pay-child', subscriptionId: 'sub-reviewed',
    };
    vi.mocked(prisma.$queryRaw).mockResolvedValue(ambiguous ? [row, { ...row, eventId: 'evt-other' }] : [row]);
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValue({ origin: 'EXTERNAL' });
    const operation = resolveExternalChildReview({
      manifest: { version: 1, contaId: 'tenant-reviewed', reviewedAt: '2026-11-03T00:00:00.000Z', reason: 'reviewed',
        approvedExternalSubscriptionIds: ['sub-reviewed'], approvedExternalPaymentIds: ['pay-child'], openIssues: [], externalEvidence: [evidence] },
      evidence,
    });
    if (ambiguous) await expect(operation).rejects.toThrow('não possui evento com vínculo exato');
    else await expect(operation).resolves.toBe('READY');
    expect(issueUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('keeps a historical issue open if a local owner appears after preflight', async () => {
    const lastSeenAt = new Date('2026-10-30T16:08:19.333Z');
    vi.mocked(getPayment).mockResolvedValue({
      id: 'pay-reviewed', subscription: 'sub-old', status: 'RECEIVED_IN_CASH', value: 170,
      dueDate: '2026-06-10', paymentDate: '2026-07-11', deleted: false, externalReference: 'legacy-ref',
    } as never);
    vi.mocked(getSubscription).mockResolvedValue({ id: 'sub-old', status: 'INACTIVE', deleted: true } as never);
    vi.mocked(prisma.financeReconciliationIssue.findFirst).mockResolvedValue({
      id: 'issue-reviewed', contaId: 'tenant-reviewed', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
      entityType: 'SUBSCRIPTION', entityId: null, asaasId: 'pay-reviewed', status: 'OPEN',
      lastSeenAt, metadata: { reason: 'alusa_subscription_without_local_entity', lastCauseId: 'cause-reviewed' },
    } as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(tx.charge.findFirst).mockResolvedValue({ id: 'charge-created-after-preflight' } as never);

    const result = await resolveHistoricalPayment({
      manifest: {
        version: 1, contaId: 'tenant-reviewed', reviewedAt: '2026-11-03T00:00:00.000Z', reason: 'reviewed',
        approvedExternalSubscriptionIds: [], approvedExternalPaymentIds: [], openIssues: [{
          id: 'issue-reviewed', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY', entityType: 'SUBSCRIPTION',
          entityId: null, asaasId: 'pay-reviewed', lastSeenAt: lastSeenAt.toISOString(),
        }], externalEvidence: [],
      },
      item: {
        issueId: 'issue-reviewed', paymentId: 'pay-reviewed', subscriptionId: 'sub-old', externalReference: 'legacy-ref',
        reason: 'operator confirmed old enrollment', expectedStatus: 'RECEIVED_IN_CASH', expectedValue: 170,
        expectedDueDate: '2026-06-10', expectedPaymentDate: '2026-07-11',
        expectedIssueReason: 'alusa_subscription_without_local_entity', expectedIssueLastSeenAt: lastSeenAt.toISOString(),
        expectedCauseId: 'cause-reviewed',
      },
      apiKey: 'test-key', auditContext: { operatorLabel: 'operator', runId: 'run-1' }, apply: true,
    });

    expect(result).toBe('SKIPPED_STALE');
    expect(issueUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('keeps an absent terminal lag issue open if its tenant-local payment owner appears after preflight', async () => {
    const lastSeenAt = new Date('2026-10-01T00:00:00.000Z');
    const issueManifest = {
      id: 'issue-terminal-lag', issueType: 'WEBHOOK_LAG', entityType: 'CHARGE',
      entityId: 'charge-terminal-lag', asaasId: 'pay-terminal-lag', lastSeenAt: lastSeenAt.toISOString(),
    };
    vi.mocked(getPayment).mockResolvedValue({
      id: 'pay-terminal-lag', status: 'DELETED', deleted: true,
    } as never);
    vi.mocked(prisma.financeReconciliationIssue.findFirst).mockResolvedValue({
      ...issueManifest, contaId: 'tenant-reviewed', status: 'OPEN', lastSeenAt,
    } as never);
    vi.mocked(tx.charge.findFirst).mockResolvedValue({ id: 'charge-created-after-preflight' } as never);

    const result = await resolveAbsentTerminalLagIssue({
      manifest: {
        version: 1, contaId: 'tenant-reviewed', reviewedAt: '2026-11-03T00:00:00.000Z', reason: 'reviewed',
        approvedExternalSubscriptionIds: [], approvedExternalPaymentIds: [], openIssues: [issueManifest], externalEvidence: [],
      },
      issueManifest, apiKey: 'test-key', auditContext: { operatorLabel: 'operator', runId: 'run-2' }, apply: true,
    });

    expect(result).toBe('SKIPPED_STALE');
    expect(issueUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('keeps an absent terminal lag issue open if its tenant-local subscription owner appears after preflight', async () => {
    const lastSeenAt = new Date('2026-10-01T00:00:00.000Z');
    const issueManifest = {
      id: 'issue-terminal-subscription-lag', issueType: 'WEBHOOK_LAG', entityType: 'SUBSCRIPTION',
      entityId: 'subscription-terminal-lag', asaasId: 'sub-terminal-lag', lastSeenAt: lastSeenAt.toISOString(),
    };
    vi.mocked(getSubscription).mockResolvedValue({
      id: 'sub-terminal-lag', status: 'INACTIVE', deleted: true,
    } as never);
    vi.mocked(prisma.financeReconciliationIssue.findFirst).mockResolvedValue({
      ...issueManifest, contaId: 'tenant-reviewed', status: 'OPEN', lastSeenAt,
    } as never);
    vi.mocked(tx.subscription.findFirst).mockResolvedValue({ id: 'subscription-created-after-preflight' } as never);

    const result = await resolveAbsentTerminalLagIssue({
      manifest: {
        version: 1, contaId: 'tenant-reviewed', reviewedAt: '2026-11-03T00:00:00.000Z', reason: 'reviewed',
        approvedExternalSubscriptionIds: [], approvedExternalPaymentIds: [], openIssues: [issueManifest], externalEvidence: [],
      },
      issueManifest, apiKey: 'test-key', auditContext: { operatorLabel: 'operator', runId: 'run-4' }, apply: true,
    });

    expect(result).toBe('SKIPPED_STALE');
    expect(issueUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('keeps a canonical-payment issue open if its Charge/Cobranca link changes before CAS', async () => {
    const lastSeenAt = new Date('2026-10-01T00:00:00.000Z');
    const issueManifest = {
      id: 'issue-canonical-link', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY', entityType: 'PAYMENT',
      entityId: 'charge-existing', asaasId: 'pay-existing', lastSeenAt: lastSeenAt.toISOString(),
    };
    const issue = {
      ...issueManifest, contaId: 'tenant-reviewed', status: 'OPEN', lastSeenAt,
      metadata: { manualRepair: true, resolvedLocalEntityId: 'cob-existing', lastCauseId: 'cause-canonical' },
    };
    const externalReference = 'enrollment-op:operation-existing:fee';
    vi.mocked(prisma.financeReconciliationIssue.findFirst).mockResolvedValue(issue as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValue({
      id: 'charge-existing', cobrancaId: 'cob-existing', externalReference, status: 'OPEN',
    } as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue({
      id: 'cob-existing', asaasPaymentId: 'pay-existing', status: 'PENDENTE',
    } as never);
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockResolvedValue({
      id: 'operation-existing', asaasEnrollmentFeePaymentId: 'pay-existing', asaasFirstPaymentId: null,
    } as never);
    vi.mocked(getPayment).mockResolvedValue({
      id: 'pay-existing', externalReference, status: 'PENDING', deleted: false,
    } as never);
    vi.mocked(tx.charge.findFirst).mockResolvedValue({
      id: 'charge-existing', cobrancaId: 'different-cobranca', externalReference, status: 'OPEN',
    } as never);
    vi.mocked(tx.cobranca.findFirst).mockResolvedValue({
      id: 'cob-existing', asaasPaymentId: 'pay-existing', status: 'PENDENTE',
    } as never);

    const result = await resolveAlreadyLinkedPaymentIssue({
      manifest: {
        version: 1, contaId: 'tenant-reviewed', reviewedAt: '2026-11-03T00:00:00.000Z', reason: 'reviewed',
        approvedExternalSubscriptionIds: [], approvedExternalPaymentIds: [], openIssues: [issueManifest], externalEvidence: [],
      },
      issueManifest, apiKey: 'test-key', auditContext: { operatorLabel: 'operator', runId: 'run-3' }, apply: true,
    });

    expect(result).toBe('SKIPPED_STALE');
    expect(issueUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
