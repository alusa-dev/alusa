import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { prisma, tx, getPayment, getSubscription, listPayments, auditCreate, issueUpdate } = vi.hoisted(() => {
  const auditCreate = vi.fn();
  const issueUpdate = vi.fn();
  const model = () => ({ findFirst: vi.fn().mockResolvedValue(null) });
  const tx = {
    charge: model(), cobranca: model(), pagamento: model(), subscription: model(),
    standaloneSubscription: model(), billingAgreement: model(), matricula: model(),
    enrollmentCreationOperation: model(), acordoFinanceiroFuturo: model(), eventMapOrder: model(),
    financeReconciliationIssue: { updateMany: issueUpdate },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    charge: model(), cobranca: model(), pagamento: model(), subscription: model(),
    standaloneSubscription: model(), billingAgreement: model(), matricula: model(),
    enrollmentCreationOperation: model(), acordoFinanceiroFuturo: model(), eventMapOrder: model(),
    financeReconciliationIssue: { findFirst: vi.fn() },
    asaasResourceOrigin: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx, getPayment: vi.fn(), getSubscription: vi.fn(), listPayments: vi.fn(), auditCreate, issueUpdate };
});

vi.mock('@alusa/database', () => ({ prisma, loadAsaasCredentials: vi.fn() }));
vi.mock('../../../../packages/asaas/src', () => ({ getPayment, getSubscription, listPayments }));
vi.mock('./asaas-resource-origin.service', () => ({
  classifyPreviewedExternalSubscription: vi.fn(), previewExternalSubscriptionCandidates: vi.fn(),
}));
vi.mock('../foundation/webhook-job-lock.service', () => ({
  acquireWebhookJobLock: vi.fn(), releaseWebhookJobLock: vi.fn(), renewWebhookJobLock: vi.fn(),
}));
vi.mock('../webhooks/webhook-reconciliation.service', () => ({ reconcileWithAsaas: vi.fn() }));


import {
  runRecovery,
  resolveVerifiedEventCancellation,
  resolveExternalChildReview,
  resolveAbsentTerminalLagIssue,
  resolveAlreadyLinkedPaymentIssue,
  resolveHistoricalPayment,
} from '../../../../scripts/recover-finance-reconciliation-lifecycle';

import { loadAsaasCredentials } from '@alusa/database';
import { acquireWebhookJobLock, releaseWebhookJobLock } from '../foundation/webhook-job-lock.service';
import { previewExternalSubscriptionCandidates } from './asaas-resource-origin.service';
import { reconcileWithAsaas } from '../webhooks/webhook-reconciliation.service';

describe('finance recovery lifecycle race guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueUpdate.mockResolvedValue({ count: 1 });
    auditCreate.mockResolvedValue({});
    for (const row of [tx.charge, tx.cobranca, tx.pagamento, tx.subscription, tx.standaloneSubscription,
      tx.billingAgreement, tx.matricula, tx.enrollmentCreationOperation, tx.acordoFinanceiroFuturo, tx.eventMapOrder,
      prisma.charge, prisma.cobranca, prisma.pagamento, prisma.subscription, prisma.standaloneSubscription,
      prisma.billingAgreement, prisma.matricula, prisma.enrollmentCreationOperation, prisma.acordoFinanceiroFuturo, prisma.eventMapOrder]) {
      vi.mocked(row.findFirst).mockResolvedValue(null);
    }
  });

  function canonicalCycleFixture() {
    const lastSeenAt = new Date('2026-11-03T13:00:00.000Z');
    const issueManifest = { id: 'issue-cycle', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY', entityType: 'PAYMENT',
      entityId: null, asaasId: 'pay-cycle', lastSeenAt: lastSeenAt.toISOString() };
    const issue = { ...issueManifest, lastSeenAt, status: 'OPEN', remoteStatus: 'PENDING', metadata: {
      manualRepair: 'legacy_subscription_cycle_reconciliation', resolvedLocalEntityId: 'cob-cycle', lastCauseId: 'evt-cycle',
    } };
    const charge = { id: 'charge-cycle', cobrancaId: 'cob-cycle', externalReference: 'enrollment-op:op-cycle:subscription:payment:pay-cycle',
      status: 'OPEN', value: 170, dueDate: new Date('2026-11-10T12:00:00.000Z') };
    const cobranca = { id: 'cob-cycle', matriculaId: 'mat-cycle', asaasPaymentId: 'pay-cycle', asaasId: 'pay-cycle',
      status: 'A_VENCER', valor: 170, vencimento: new Date('2026-11-10T12:00:00.000Z') };
    const operation = { id: 'op-cycle', status: 'COMMITTED', matriculaId: 'mat-cycle', asaasSubscriptionId: 'sub-parent', asaasFirstPaymentId: 'pay-other-first' };
    const subscription = { id: 'sub-local', status: 'ACTIVE', matriculaId: 'mat-cycle', externalReference: 'enrollment-op:op-cycle:subscription' };
    prisma.financeReconciliationIssue.findFirst.mockResolvedValue(issue);
    for (const db of [prisma, tx]) {
      db.charge.findFirst.mockResolvedValue(charge); db.cobranca.findFirst.mockResolvedValue(cobranca);
      db.enrollmentCreationOperation.findFirst.mockResolvedValue(operation); db.subscription.findFirst.mockResolvedValue(subscription);
      db.matricula.findFirst.mockResolvedValue({ id: 'mat-cycle' });
    }
    getPayment.mockResolvedValue({ id: 'pay-cycle', subscription: 'sub-parent', externalReference: subscription.externalReference,
      status: 'PENDING', value: 170, dueDate: '2026-11-10', deleted: false });
    getSubscription.mockResolvedValue({ id: 'sub-parent', externalReference: subscription.externalReference, status: 'ACTIVE', deleted: false });
    return { issue, charge, cobranca, operation, subscription, input: {
      manifest: { version: 1 as const, contaId: 'tenant-reviewed', reviewedAt: '2026-11-03', reason: 'reviewed',
        approvedExternalSubscriptionIds: [], approvedExternalPaymentIds: [], openIssues: [issueManifest], externalEvidence: [] },
      issueManifest, apiKey: 'test-key', auditContext: { operatorLabel: 'operator', runId: 'run-cycle' }, apply: true,
    } };
  }

  it('resolves a string-marked recurring cycle through its committed parent chain, independently of first payment', async () => {
    const { input, issue } = canonicalCycleFixture();
    await expect(resolveAlreadyLinkedPaymentIssue(input)).resolves.toBe('RESOLVED');
    expect(issueUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      metadata: { equals: issue.metadata }, lastSeenAt: issue.lastSeenAt, asaasId: 'pay-cycle',
    }) }));
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      metadata: expect.objectContaining({ subscriptionId: 'sub-local', enrollmentId: 'mat-cycle', operationId: 'op-cycle' }),
    }) }));
  });

  it.each(['wrong-parent', 'wrong-suffix', 'uncommitted', 'wrong-enrollment', 'wrong-value', 'wrong-date'])('rejects recurring proof: %s', async (scenario) => {
    const { input, charge, operation } = canonicalCycleFixture();
    if (scenario === 'wrong-parent') getPayment.mockResolvedValue({ id: 'pay-cycle', subscription: 'sub-other', status: 'PENDING' });
    if (scenario === 'wrong-suffix') prisma.charge.findFirst.mockResolvedValue({ ...charge, externalReference: 'enrollment-op:op-cycle:subscription:payment:pay-other' });
    if (scenario === 'uncommitted') prisma.enrollmentCreationOperation.findFirst.mockResolvedValue({ ...operation, status: 'PENDING' });
    if (scenario === 'wrong-enrollment') prisma.enrollmentCreationOperation.findFirst.mockResolvedValue({ ...operation, matriculaId: 'mat-other' });
    if (scenario === 'wrong-value') prisma.charge.findFirst.mockResolvedValue({ ...charge, value: 171 });
    if (scenario === 'wrong-date') prisma.charge.findFirst.mockResolvedValue({ ...charge, dueDate: new Date('2026-11-11T12:00:00.000Z') });
    await expect(resolveAlreadyLinkedPaymentIssue(input)).rejects.toThrow();
    expect(issueUpdate).not.toHaveBeenCalled(); expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each(['charge-status', 'subscription-parent', 'issue-cause'])('preserves recurring issue on concurrent %s change', async (scenario) => {
    const { input, charge, subscription } = canonicalCycleFixture();
    if (scenario === 'charge-status') tx.charge.findFirst.mockResolvedValue({ ...charge, status: 'PAID' });
    if (scenario === 'subscription-parent') tx.subscription.findFirst.mockResolvedValue({ ...subscription, matriculaId: 'mat-other' });
    if (scenario === 'issue-cause') issueUpdate.mockResolvedValueOnce({ count: 0 });
    await expect(resolveAlreadyLinkedPaymentIssue(input)).resolves.toBe('SKIPPED_STALE');
    expect(auditCreate).not.toHaveBeenCalled();
  });

  function legacyEventFixture() {
    const lastSeenAt = new Date('2026-11-03T13:00:00.000Z');
    const issueManifest = { id: 'issue-event', issueType: 'BILLING_OPERATION_UNCERTAIN', entityType: 'PAYMENT',
      entityId: 'order-cancelled', asaasId: null, lastSeenAt: lastSeenAt.toISOString() };
    const issue = { ...issueManifest, lastSeenAt, status: 'OPEN', remoteStatus: 'BUYER_CUSTOMER_NOT_CONFIRMED', metadata: {
      orderId: 'order-cancelled', paymentId: 'pay-cancelled', externalReference: 'event-map-order:order-cancelled', lookupError: 'MULTIPLE_BUYER_CUSTOMERS',
    } };
    const order = { id: 'order-cancelled', status: 'CANCELLED', paymentStatus: 'DELETED', paymentProvider: 'ASAAS', asaasPaymentId: 'pay-cancelled' };
    prisma.financeReconciliationIssue.findFirst.mockResolvedValue(issue);
    prisma.eventMapOrder.findFirst.mockResolvedValue(order); tx.eventMapOrder.findFirst.mockResolvedValue(order);
    const payment = { id: 'pay-cancelled', externalReference: 'event-map-order:order-cancelled', status: 'DELETED', deleted: true };
    getPayment.mockResolvedValue(payment);
    listPayments.mockResolvedValue({ data: [payment], totalCount: 1, offset: 0, limit: 100, hasMore: false });
    return { issue, order, payment, input: { manifest: {
      version: 1 as const, contaId: 'tenant-reviewed', reviewedAt: '2026-11-03', reason: 'reviewed', approvedExternalSubscriptionIds: [],
      approvedExternalPaymentIds: [], openIssues: [issueManifest], externalEvidence: [],
    }, issueManifest, apiKey: 'test-key', auditContext: { operatorLabel: 'operator', runId: 'run-event' }, apply: true } };
  }

  it('resolves legacy event ambiguity with null original provider ID and no cause using full metadata CAS', async () => {
    const { input, issue } = legacyEventFixture();
    await expect(resolveVerifiedEventCancellation(input)).resolves.toBe('RESOLVED');
    expect(issueUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      asaasId: null, entityId: 'order-cancelled', metadata: { equals: issue.metadata },
      remoteStatus: 'BUYER_CUSTOMER_NOT_CONFIRMED', lastSeenAt: issue.lastSeenAt,
    }) }));
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it('accepts an empty complete available listing only after the known target GET confirms deletion', async () => {
    const { input } = legacyEventFixture();
    listPayments.mockResolvedValue({ data: [], totalCount: 0, offset: 0, limit: 100, hasMore: false });
    await expect(resolveVerifiedEventCancellation(input)).resolves.toBe('RESOLVED');
    expect(listPayments).toHaveBeenCalledWith({ apiKey: 'test-key', externalReference: 'event-map-order:order-cancelled', offset: 0, limit: 100 });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({
      providerEvidence: 'KNOWN_TARGET_GET_DELETED_AND_NO_AVAILABLE_ALTERNATIVE', availableReferencePaymentCount: 0,
    }) }) }));
  });

  it('rejects an empty listing when the exact GET does not prove target deletion', async () => {
    const { input, payment } = legacyEventFixture();
    listPayments.mockResolvedValue({ data: [], totalCount: 0, offset: 0, limit: 100, hasMore: false });
    getPayment.mockResolvedValue({ ...payment, deleted: false, status: 'PENDING' });
    await expect(resolveVerifiedEventCancellation(input)).rejects.toThrow('não está excluído');
    expect(listPayments).not.toHaveBeenCalled(); expect(issueUpdate).not.toHaveBeenCalled();
  });

  it.each(['conflicting-reason', 'cause-without-reason', 'duplicate-target', 'wrong-reference', 'inconsistent-target-state'])('rejects legacy event proof: %s', async (scenario) => {
    const { input, issue, payment } = legacyEventFixture();
    if (scenario === 'conflicting-reason') prisma.financeReconciliationIssue.findFirst.mockResolvedValue({ ...issue, metadata: { ...issue.metadata, reason: 'REMOTE_CREATION_RESULT_STILL_UNCERTAIN' } });
    if (scenario === 'cause-without-reason') prisma.financeReconciliationIssue.findFirst.mockResolvedValue({ ...issue, metadata: { ...issue.metadata, lastCauseId: 'cause-new' } });
    const rows = scenario === 'duplicate-target' ? [payment, payment]
      : [{ ...payment, ...(scenario === 'wrong-reference' ? { externalReference: 'event-map-order:other' } : { deleted: false }) }];
    if (!['conflicting-reason', 'cause-without-reason'].includes(scenario)) listPayments.mockResolvedValue({ data: rows, totalCount: rows.length, offset: 0, limit: 100, hasMore: false });
    await expect(resolveVerifiedEventCancellation(input)).rejects.toThrow();
    expect(issueUpdate).not.toHaveBeenCalled(); expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each(['wrong-order', 'duplicate-active', 'incomplete-page', 'other-reason'])('rejects legacy event: %s', async (scenario) => {
    const { input, order, payment, issue } = legacyEventFixture();
    if (scenario === 'wrong-order') prisma.eventMapOrder.findFirst.mockResolvedValue({ ...order, asaasPaymentId: 'pay-other' });
    if (scenario === 'duplicate-active') listPayments.mockResolvedValue({ data: [payment, { ...payment, id: 'pay-active', status: 'PENDING', deleted: false }], totalCount: 2, offset: 0, limit: 100, hasMore: false });
    if (scenario === 'incomplete-page') listPayments.mockResolvedValue({ data: [payment], totalCount: 2, offset: 0, limit: 100, hasMore: false });
    if (scenario === 'other-reason') prisma.financeReconciliationIssue.findFirst.mockResolvedValue({ ...issue, metadata: { ...issue.metadata, lookupError: 'OTHER_ERROR' } });
    await expect(resolveVerifiedEventCancellation(input)).rejects.toThrow();
    expect(issueUpdate).not.toHaveBeenCalled(); expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each(['metadata', 'order-state'])('preserves event issue on concurrent %s change', async (scenario) => {
    const { input, order } = legacyEventFixture();
    if (scenario === 'metadata') issueUpdate.mockResolvedValueOnce({ count: 0 });
    if (scenario === 'order-state') tx.eventMapOrder.findFirst.mockResolvedValue({ ...order, paymentStatus: 'PENDING' });
    await expect(resolveVerifiedEventCancellation(input)).resolves.toBe('SKIPPED_STALE');
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('discovers string-marked cycle and null-ID legacy event through the real dry-run entrypoint', async () => {
    const cycle = canonicalCycleFixture();
    const event = legacyEventFixture();
    prisma.financeReconciliationIssue.findFirst.mockImplementation(async ({ where }) => where.id === cycle.issue.id ? cycle.issue : event.issue);
    getPayment.mockImplementation(async ({ paymentId }) => paymentId === 'pay-cycle'
      ? { id: 'pay-cycle', subscription: 'sub-parent', externalReference: 'enrollment-op:op-cycle:subscription',
          status: 'PENDING', value: 170, dueDate: '2026-11-10', deleted: false }
      : event.payment);
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-key' } as never);
    vi.mocked(acquireWebhookJobLock).mockResolvedValue({ acquired: true, jobName: 'test-lock', workerId: 'test-worker' } as never);
    vi.mocked(previewExternalSubscriptionCandidates).mockResolvedValue({ items: [], nextCursor: null } as never);
    vi.mocked(reconcileWithAsaas).mockResolvedValue({ checkedPayments: 0, checkedSubscriptions: 0, paymentDrift: 0, subscriptionDrift: 0, asaasCalls: 0, budgetExhausted: false } as never);
    const directory = await mkdtemp(join(tmpdir(), 'alusa-recovery-test-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const manifestPath = join(directory, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify({ ...cycle.input.manifest, openIssues: [...cycle.input.manifest.openIssues, ...event.input.manifest.openIssues] }));
      await runRecovery({ manifestPath, apply: false, auditContext: { operatorLabel: 'operator', runId: 'run-dry' } });
      expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ mode: 'dry-run', manuallyRepairedIssues: 1, eventCancellations: 1 });
      expect(issueUpdate).not.toHaveBeenCalled(); expect(auditCreate).not.toHaveBeenCalled();
      expect(releaseWebhookJobLock).toHaveBeenCalledWith({ jobName: 'test-lock', workerId: 'test-worker' });
    } finally {
      log.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts another verifier resolution without rechecking or writing, and skips newer open observations', async () => {
    const { input, issue } = legacyEventFixture();
    prisma.financeReconciliationIssue.findFirst.mockResolvedValue({ ...issue, status: 'RESOLVED', resolution: 'Verified by another safe reconciler' });
    await expect(resolveVerifiedEventCancellation(input)).resolves.toBe('ALREADY_RESOLVED');
    prisma.financeReconciliationIssue.findFirst.mockResolvedValue({ ...issue, lastSeenAt: new Date(issue.lastSeenAt.getTime() + 1) });
    await expect(resolveVerifiedEventCancellation(input)).resolves.toBe('SKIPPED_STALE');
    expect(getPayment).not.toHaveBeenCalled(); expect(issueUpdate).not.toHaveBeenCalled();
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
