import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(), subscription: { findFirst: vi.fn() }, standaloneSubscription: { findFirst: vi.fn() },
  billingAgreement: { findFirst: vi.fn() }, matricula: { findFirst: vi.fn() }, enrollmentCreationOperation: { findFirst: vi.fn() },
  acordoFinanceiroFuturo: { findFirst: vi.fn() },
  webhookAsaas: { findFirst: vi.fn(), updateMany: vi.fn() }, asaasResourceOrigin: { findUnique: vi.fn(), upsert: vi.fn() },
  financeReconciliationIssue: { findFirst: vi.fn(), updateMany: vi.fn() },
  charge: { findFirst: vi.fn() }, cobranca: { findFirst: vi.fn() }, pagamento: { findFirst: vi.fn() },
  eventMapOrder: { findFirst: vi.fn() }, eventTicketSale: { findFirst: vi.fn() }, eventFinancialEntry: { findFirst: vi.fn() },
  eventParticipant: { findFirst: vi.fn() }, eventBillingGroup: { findFirst: vi.fn() }, auditLog: { create: vi.fn() },
  pendingInboxNotification: { findMany: vi.fn(), updateMany: vi.fn() },
  installmentPlan: { findFirst: vi.fn() }, standaloneInstallmentPlan: { findFirst: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@alusa/database', () => ({ prisma: prismaMock }));

import { prisma } from '@alusa/database';
import { classifyAsaasResourceOrigin, classifyPreviewedExternalInstallment, classifyPreviewedExternalPayment, classifyPreviewedExternalSubscription, previewExternalInstallmentCandidates, previewExternalPaymentCandidates, previewExternalSubscriptionCandidates } from './asaas-resource-origin.service';

const eligibleRow = {
  subscriptionId: 'sub-a', relatedPayments: 3, hasCanonicalReference: false,
  hasSubscriptionRecord: false, hasStandaloneSubscription: false, hasBillingAgreement: false, hasEnrollment: false,
  hasEnrollmentOperation: false, hasFutureRenewalAgreement: false, priorOrigin: null, hasAlusaPaymentOrigin: false, samplePaymentIds: [],
};

describe('Asaas resource origin preview and classification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(txMock as never) as never);
    vi.mocked(txMock.subscription.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.standaloneSubscription.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.billingAgreement.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.matricula.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.enrollmentCreationOperation.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.acordoFinanceiroFuturo.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.pagamento.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.eventMapOrder.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.eventTicketSale.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.eventFinancialEntry.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.eventParticipant.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.eventBillingGroup.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.installmentPlan.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.standaloneInstallmentPlan.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.webhookAsaas.findFirst).mockResolvedValue({ id: 'event-a' } as never);
    vi.mocked(txMock.asaasResourceOrigin.findUnique).mockResolvedValue(null as never);
    vi.mocked(txMock.asaasResourceOrigin.upsert).mockResolvedValue({ id: 'origin-a', origin: 'EXTERNAL' } as never);
    vi.mocked(txMock.auditLog.create).mockResolvedValue({ id: 'audit-a' } as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValue([] as never);
    vi.mocked(txMock.pendingInboxNotification.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(txMock.webhookAsaas.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(txMock.financeReconciliationIssue.findFirst).mockResolvedValue(null as never);
    vi.mocked(txMock.financeReconciliationIssue.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it('paginates a bounded aggregate preview without selecting webhook payloads', async () => {
    vi.mocked(txMock.$queryRaw)
      .mockResolvedValueOnce([eligibleRow, { ...eligibleRow, subscriptionId: 'sub-b' }] as never)
      .mockResolvedValueOnce([{ total: 8n }] as never);
    const result = await previewExternalSubscriptionCandidates({ contaId: 'conta-a', pageSize: 1, db: txMock as never });
    expect(result).toEqual({
      items: [{ subscriptionId: 'sub-a', relatedPaymentCount: 3, samplePaymentIds: [], evidence: [
        'EVENTS_STORED_FOR_TENANT', 'NO_CANONICAL_ALUSA_REFERENCE_IN_STORED_EVENTS', 'NO_RELATED_PAYMENT_CLASSIFIED_ALUSA',
      ], eligible: true, conflict: null }],
      total: 8, pageSize: 1, nextCursor: 'sub-a',
    });
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rechecks the exact preview eligibility within the serializable transaction before writing and audits atomically', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([eligibleRow] as never);
    const result = await classifyPreviewedExternalSubscription({
      contaId: 'conta-a', subscriptionId: 'sub-a', actorId: 'admin-a', reason: 'Criada pela escola no Asaas', db: txMock as never,
    });
    expect(result.changed).toBe(true);
    expect(txMock.asaasResourceOrigin.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_asaas_resource_origin_tenant_resource: { contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-a' } },
    }));
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contaId: 'conta-a', actorId: 'admin-a' }) }));
  });

  it('resets an exhausted persisted payment webhook replay budget after ALUSA classification and keeps review open', async () => {
    vi.mocked(txMock.charge.findFirst).mockResolvedValueOnce({ id: 'charge-a' } as never);
    vi.mocked(txMock.financeReconciliationIssue.findFirst).mockResolvedValueOnce({
      id: 'review-a', metadata: { source: 'payment-webhook-handler', reason: 'resource_origin_unknown', lastCauseId: 'event-a' },
    } as never);

    const result = await classifyAsaasResourceOrigin({
      contaId: 'conta-a', resourceType: 'PAYMENT', asaasId: 'pay-a', origin: 'ALUSA',
      actorId: 'admin-a', reason: 'Vínculo local confirmado', db: txMock as never,
    });

    expect(result.requeued).toBe(1);
    expect(result.resolved).toBe(0);
    expect(txMock.webhookAsaas.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ contaId: 'conta-a', eventId: 'event-a', asaasPaymentId: 'pay-a', evento: { startsWith: 'PAYMENT_' }, OR: expect.arrayContaining([
        { status: { in: ['PROCESSANDO', 'PROCESSADO', 'EXAURIDO'] } },
        { status: 'ERRO', tentativas: { gte: 5 } },
      ]) }),
      data: expect.objectContaining({ status: 'ERRO', tentativas: 0, nextRetryAt: expect.any(Date), ultimoErro: expect.stringContaining('replay') }),
    });
    // The worker claims ERRO rows only while tentativas < maxAttempts; attemptsLog
    // is deliberately absent from the update so the prior delivery history survives.
    const resetAttempts = txMock.webhookAsaas.updateMany.mock.calls[0]?.[0].data.tentativas;
    expect(resetAttempts).toBeLessThan(5);
    expect(txMock.webhookAsaas.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('attemptsLog');
    expect(txMock.financeReconciliationIssue.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      contaId: 'conta-a', actorId: 'admin-a', action: 'finance.asaas_resource_origin.webhook_requeued',
      metadata: expect.objectContaining({ eventId: 'event-a', asaasId: 'pay-a' }),
    }) }));
  });

  it('resolves webhook-first unknown subscription as EXTERNAL without replay or financial effects', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{ ...eligibleRow, subscriptionId: 'sub-external' }] as never);
    vi.mocked(txMock.financeReconciliationIssue.findFirst).mockResolvedValueOnce({
      id: 'review-sub-external', metadata: { reason: 'resource_origin_unknown', lastCauseId: 'evt-sub-external' },
    } as never);

    const result = await classifyPreviewedExternalSubscription({
      contaId: 'conta-a', subscriptionId: 'sub-external', actorId: 'admin-a',
      reason: 'Assinatura externa confirmada', db: txMock as never,
    });

    expect(result.resolved).toBe(1);
    expect(result.requeued).toBe(0);
    expect(txMock.financeReconciliationIssue.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', entityType: 'SUBSCRIPTION', asaasId: 'sub-external', issueType: 'SUBSCRIPTION_NEEDS_REVIEW' }),
    }));
    expect(txMock.financeReconciliationIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'review-sub-external', contaId: 'conta-a', status: 'OPEN',
        AND: [
          { metadata: { path: ['reason'], equals: 'resource_origin_unknown' } },
          { metadata: { path: ['lastCauseId'], equals: 'evt-sub-external' } },
        ],
      }),
      data: expect.objectContaining({ status: 'RESOLVED' }),
    }));
    expect(txMock.webhookAsaas.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      contaId: 'conta-a', actorId: 'admin-a', action: 'finance.asaas_resource_origin.external_review_resolved',
      metadata: expect.objectContaining({ resourceType: 'SUBSCRIPTION', asaasId: 'sub-external', resolution: 'EXTERNAL_ORIGIN_CLASSIFIED_NO_FINANCIAL_REPLAY' }),
    }) }));
  });

  it('resets an exhausted same-tenant subscription webhook replay budget after ALUSA classification and keeps review open', async () => {
    vi.mocked(txMock.billingAgreement.findFirst).mockResolvedValue({ id: 'agreement-a' } as never);
    vi.mocked(txMock.financeReconciliationIssue.findFirst).mockResolvedValueOnce({
      id: 'review-sub-alusa', metadata: { reason: 'resource_origin_unknown', lastCauseId: 'evt-sub-alusa' },
    } as never);

    const result = await classifyAsaasResourceOrigin({
      contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-alusa', origin: 'ALUSA',
      actorId: 'admin-a', reason: 'Vínculo local confirmado', db: txMock as never,
    });

    expect(result.requeued).toBe(1);
    expect(result.resolved).toBe(0);
    expect(txMock.webhookAsaas.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ contaId: 'conta-a', eventId: 'evt-sub-alusa', asaasSubscriptionId: 'sub-alusa', evento: { startsWith: 'SUBSCRIPTION_' }, OR: expect.arrayContaining([
        { status: { in: ['PROCESSANDO', 'PROCESSADO', 'EXAURIDO'] } },
        { status: 'ERRO', tentativas: { gte: 5 } },
      ]) }),
      data: expect.objectContaining({ status: 'ERRO', tentativas: 0, nextRetryAt: expect.any(Date), ultimoErro: expect.stringContaining('replay') }),
    });
    const resetAttempts = txMock.webhookAsaas.updateMany.mock.calls[0]?.[0].data.tentativas;
    expect(resetAttempts).toBeLessThan(5);
    expect(txMock.webhookAsaas.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('attemptsLog');
    expect(txMock.financeReconciliationIssue.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      contaId: 'conta-a', actorId: 'admin-a', action: 'finance.asaas_resource_origin.webhook_requeued',
      metadata: expect.objectContaining({ eventId: 'evt-sub-alusa', asaasId: 'sub-alusa', resolution: 'ALUSA_ORIGIN_CLASSIFIED_REPLAY_PENDING' }),
    }) }));
  });

  it.each(['PROCESSANDO', 'PROCESSADO'] as const)('requeues ALUSA subscription event from %s and fences its old PROCESSANDO finalizer', async (status) => {
    vi.mocked(txMock.billingAgreement.findFirst).mockResolvedValue({ id: 'agreement-race' } as never);
    vi.mocked(txMock.financeReconciliationIssue.findFirst).mockResolvedValueOnce({
      id: 'review-race', metadata: { reason: 'resource_origin_unknown', lastCauseId: 'evt-race' },
    } as never);
    vi.mocked(txMock.webhookAsaas.updateMany).mockImplementationOnce(async (args) => {
      expect(args.where).toEqual({
        contaId: 'conta-a', eventId: 'evt-race', asaasSubscriptionId: 'sub-race',
        evento: { startsWith: 'SUBSCRIPTION_' },
        OR: [
          { status: { in: ['PROCESSANDO', 'PROCESSADO', 'EXAURIDO'] } },
          { status: 'ERRO', tentativas: { gte: 5 } },
        ],
      });
      expect(args.data).toEqual(expect.objectContaining({ status: 'ERRO', tentativas: 0 }));
      return { count: 1 } as never;
    }).mockImplementationOnce(async (args) => {
      // This is the old worker's finalizer CAS (PROCESSANDO + its claimed attempt).
      expect(args.where).toEqual({ id: 'webhook-race', contaId: 'conta-a', status: 'PROCESSANDO', tentativas: 4 });
      return { count: 0 } as never;
    });

    await classifyAsaasResourceOrigin({
      contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-race', origin: 'ALUSA',
      actorId: 'admin-a', reason: 'Vínculo local confirmado', db: txMock as never,
    });
    const oldFinalizer = await txMock.webhookAsaas.updateMany({ where: {
      id: 'webhook-race', contaId: 'conta-a', status: 'PROCESSANDO', tentativas: 4,
    }, data: { status: 'PROCESSADO', processadoEm: new Date() } } as never);

    expect(oldFinalizer.count).toBe(0);
    expect(txMock.webhookAsaas.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('attemptsLog');
  });

  it('does not reset an active replay when the same ALUSA classification is repeated', async () => {
    vi.mocked(txMock.billingAgreement.findFirst).mockResolvedValue({ id: 'agreement-active' } as never);
    vi.mocked(txMock.asaasResourceOrigin.findUnique).mockResolvedValueOnce({
      id: 'origin-active', origin: 'ALUSA', reason: 'Vínculo local confirmado', classifiedAt: new Date(), history: [],
    } as never);
    vi.mocked(txMock.financeReconciliationIssue.findFirst).mockResolvedValueOnce({
      id: 'review-active', metadata: { reason: 'resource_origin_unknown', lastCauseId: 'evt-active' },
    } as never);
    vi.mocked(txMock.webhookAsaas.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const result = await classifyAsaasResourceOrigin({
      contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-active', origin: 'ALUSA',
      actorId: 'admin-a', reason: 'Vínculo local confirmado', db: txMock as never,
    });

    expect(result.requeued).toBe(0);
    expect(txMock.webhookAsaas.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [
        { status: { in: ['PROCESSADO', 'EXAURIDO'] } },
        { status: 'ERRO', tentativas: { gte: 5 } },
      ] }),
    }));
  });

  it.each(['matricula', 'acordoFinanceiroFuturo'] as const)(
    'rejects ALUSA subscription classification when only unsupported %s evidence exists', async (delegateName) => {
      vi.mocked(txMock[delegateName].findFirst).mockResolvedValueOnce({ id: 'unsupported-local-link' } as never);
      await expect(classifyAsaasResourceOrigin({
        contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-unsupported', origin: 'ALUSA',
        actorId: 'admin-a', reason: 'Vínculo local confirmado', db: txMock as never,
      })).rejects.toThrow('A origem ALUSA exige vínculo local confiável nesta conta.');
      expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
    },
  );

  it('does not accept a compensated enrollment operation as ALUSA replay evidence', async () => {
    vi.mocked(txMock.enrollmentCreationOperation.findFirst).mockResolvedValue({ id: 'operation-compensated' } as never);
    vi.mocked(txMock.enrollmentCreationOperation.findFirst).mockImplementationOnce(async (args) => {
      expect(args).toEqual({ where: { contaId: 'conta-a', asaasSubscriptionId: 'sub-compensated' }, select: { id: true } });
      return { id: 'operation-compensated' } as never;
    }).mockImplementationOnce(async (args) => {
      expect(args).toEqual({ where: {
        contaId: 'conta-a', asaasSubscriptionId: 'sub-compensated',
        status: { in: ['PROCESSING', 'REMOTE_PROVISIONED', 'REQUIRES_RECONCILIATION'] },
      }, select: { id: true } });
      return null as never;
    });
    await expect(classifyAsaasResourceOrigin({
      contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-compensated', origin: 'ALUSA',
      actorId: 'admin-a', reason: 'Vínculo local confirmado', db: txMock as never,
    })).rejects.toThrow('A origem ALUSA exige vínculo local confiável nesta conta.');
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
  });

  it('resolve external review without requeueing or applying financial effects', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{
      paymentId: 'pay-ext', eventCount: 1, sampleExternalReferences: [], hasCanonicalReference: false,
      hasCharge: false, hasCobranca: false, hasPagamento: false, hasEventMapOrder: false,
      hasEventTicketSale: false, hasEventFinancialEntry: false, hasEventParticipant: false,
      hasEventBillingGroup: false, priorOrigin: null,
    }] as never);
    vi.mocked(txMock.financeReconciliationIssue.findFirst).mockResolvedValueOnce({
      id: 'review-external', metadata: { reason: 'resource_origin_unknown', lastCauseId: 'event-ext' },
    } as never);

    const result = await classifyPreviewedExternalPayment({
      contaId: 'conta-a', paymentId: 'pay-ext', actorId: 'admin-a', reason: 'Cobrança externa confirmada', db: txMock as never,
    });

    expect(result.resolved).toBe(1);
    expect(result.requeued).toBe(0);
    expect(txMock.financeReconciliationIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'review-external', contaId: 'conta-a', status: 'OPEN',
        AND: [
          { metadata: { path: ['reason'], equals: 'resource_origin_unknown' } },
          { metadata: { path: ['lastCauseId'], equals: 'event-ext' } },
        ],
      }),
      data: expect.objectContaining({ status: 'RESOLVED' }),
    }));
    expect(txMock.webhookAsaas.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'finance.asaas_resource_origin.external_review_resolved',
      metadata: expect.objectContaining({ resolution: 'EXTERNAL_ORIGIN_CLASSIFIED_NO_FINANCIAL_REPLAY' }),
    }) }));
  });

  it('rejects a canonical Alusa reference discovered after preview before any write', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{ ...eligibleRow, hasCanonicalReference: true }] as never);
    await expect(classifyPreviewedExternalSubscription({
      contaId: 'conta-a', subscriptionId: 'sub-a', actorId: 'admin-a', reason: 'Tentativa com referência conflitante', db: txMock as never,
    })).rejects.toThrow('CANONICAL_ALUSA_REFERENCE');
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('treats legacy standalone-subscription external references as Alusa-owned evidence', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{ ...eligibleRow, hasCanonicalReference: true }] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never);

    const preview = await previewExternalSubscriptionCandidates({ contaId: 'conta-a', db: txMock as never });

    expect(preview.items[0]).toMatchObject({ eligible: false, conflict: 'CANONICAL_ALUSA_REFERENCE' });
  });

  it('prioritizes a local Alusa link over a prior EXTERNAL subscription classification', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{ ...eligibleRow, hasBillingAgreement: true, priorOrigin: 'EXTERNAL' }] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never);
    const preview = await previewExternalSubscriptionCandidates({ contaId: 'conta-a', db: txMock as never });
    expect(preview.items[0]).toMatchObject({ eligible: false, conflict: 'LOCAL_SUBSCRIPTION_EXISTS' });
    expect(preview.items[0]?.evidence).toContain('LOCAL_BILLING_AGREEMENT');
  });

  it('treats every local subscription source as an Alusa link and returns evidence matching the row flags', async () => {
    const sourceFlags = [
      ['hasSubscriptionRecord', 'LOCAL_SUBSCRIPTION_RECORD'], ['hasStandaloneSubscription', 'LOCAL_STANDALONE_SUBSCRIPTION'],
      ['hasBillingAgreement', 'LOCAL_BILLING_AGREEMENT'], ['hasEnrollment', 'LOCAL_ENROLLMENT'],
      ['hasEnrollmentOperation', 'LOCAL_ENROLLMENT_CREATION_OPERATION'], ['hasFutureRenewalAgreement', 'LOCAL_FUTURE_RENEWAL_AGREEMENT'],
    ] as const;
    for (const [flag, evidence] of sourceFlags) {
      vi.mocked(txMock.$queryRaw)
        .mockResolvedValueOnce([{ ...eligibleRow, [flag]: true }] as never)
        .mockResolvedValueOnce([{ total: 1n }] as never);
      const preview = await previewExternalSubscriptionCandidates({ contaId: 'conta-a', db: txMock as never });
      expect(preview.items[0]?.eligible).toBe(false);
      expect(preview.items[0]?.conflict).toBe('LOCAL_SUBSCRIPTION_EXISTS');
      expect(preview.items[0]?.evidence).toContain(evidence);
    }
  });

  it('revalidates a local BillingAgreement before external classification', async () => {
    vi.mocked(txMock.billingAgreement.findFirst).mockResolvedValue({ id: 'agreement-a' } as never);
    await expect(classifyPreviewedExternalSubscription({
      contaId: 'conta-a', subscriptionId: 'sub-a', actorId: 'admin-a', reason: 'Tentativa com vínculo local', db: txMock as never,
    })).rejects.toThrow('já possui vínculo local');
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['Subscription', 'subscription'], ['StandaloneSubscription', 'standaloneSubscription'], ['BillingAgreement', 'billingAgreement'],
    ['Matricula', 'matricula'], ['EnrollmentCreationOperation', 'enrollmentCreationOperation'], ['AcordoFinanceiroFuturo', 'acordoFinanceiroFuturo'],
  ])('revalidates local %s ownership before external classification', async (_label, delegateName) => {
    const delegate = txMock[delegateName as keyof typeof txMock] as { findFirst: ReturnType<typeof vi.fn> };
    delegate.findFirst.mockResolvedValue({ id: 'local-source' } as never);
    await expect(classifyPreviewedExternalSubscription({
      contaId: 'conta-a', subscriptionId: 'sub-a', actorId: 'admin-a', reason: 'Tentativa com vínculo local', db: txMock as never,
    })).rejects.toThrow('já possui vínculo local');
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
  });

  it('treats the same origin and reason as idempotent without another audit entry', async () => {
    vi.mocked(txMock.asaasResourceOrigin.findUnique).mockResolvedValue({ id: 'origin-a', origin: 'EXTERNAL', reason: 'Criada pela escola no Asaas' } as never);
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{ ...eligibleRow, priorOrigin: 'EXTERNAL' }] as never);
    const result = await classifyPreviewedExternalSubscription({
      contaId: 'conta-a', subscriptionId: 'sub-a', actorId: 'admin-a', reason: 'Criada pela escola no Asaas', db: txMock as never,
    });
    expect(result.changed).toBe(false);
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('previews standalone payments with bounded provider IDs and external references', async () => {
    vi.mocked(txMock.$queryRaw)
      .mockResolvedValueOnce([{
        paymentId: 'pay-avulso', eventCount: 2, sampleExternalReferences: ['school-billing-42'],
        hasCanonicalReference: false, hasCharge: false, hasCobranca: false, priorOrigin: null,
      }] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never);
    const preview = await previewExternalPaymentCandidates({ contaId: 'conta-a', pageSize: 1, db: txMock as never });
    expect(preview.items[0]).toMatchObject({
      paymentId: 'pay-avulso', eventCount: 2, sampleExternalReferences: ['school-billing-42'], eligible: true,
      evidence: expect.arrayContaining(['PAYMENT_EVENT_WITHOUT_SUBSCRIPTION_IN_TENANT_HISTORY', 'NO_CANONICAL_ALUSA_REFERENCE_IN_STORED_EVENTS']),
    });
  });

  it('revalidates payment mappings and canonical references before external classification', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{
      paymentId: 'pay-avulso', eventCount: 1, sampleExternalReferences: [], hasCanonicalReference: true,
      hasCharge: false, hasCobranca: false, priorOrigin: null,
    }] as never);
    await expect(classifyPreviewedExternalPayment({
      contaId: 'conta-a', paymentId: 'pay-avulso', actorId: 'admin-a', reason: 'Origem manual conferida', db: txMock as never,
    })).rejects.toThrow('CANONICAL_ALUSA_REFERENCE');
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('fecha inbox FAILED por esgotamento ao classificar payment EXTERNAL, sem recriar notificação', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{
      paymentId: 'pay-legacy', eventCount: 1, sampleExternalReferences: [], hasCanonicalReference: false,
      hasCharge: false, hasCobranca: false, hasPagamento: false, hasEventMapOrder: false,
      hasEventTicketSale: false, hasEventFinancialEntry: false, hasEventParticipant: false,
      hasEventBillingGroup: false, priorOrigin: null,
    }] as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([{
      id: 'pending-1', contaId: 'conta-a', kind: 'BILLING_WEBHOOK', status: 'FAILED',
      lastError: 'Entidade local não encontrada após tentativas máximas', dedupeKey: 'pending:billing:conta-a:PAYMENT_RECEIVED:pay-legacy',
      payload: { asaasPaymentId: 'pay-legacy', asaasSubscriptionId: null },
    }] as never);

    const result = await classifyPreviewedExternalPayment({
      contaId: 'conta-a', paymentId: 'pay-legacy', actorId: 'admin-a', reason: 'Pagamento legado da escola', db: txMock as never,
    });

    expect(result.pendingInboxClosed).toBe(1);
    expect(txMock.pendingInboxNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      contaId: 'conta-a', kind: 'BILLING_WEBHOOK', status: 'FAILED',
      lastError: 'Entidade local não encontrada após tentativas máximas',
      payload: { path: ['asaasPaymentId'], equals: 'pay-legacy' },
    }) }));
    expect(txMock.pendingInboxNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pending-1', contaId: 'conta-a', status: 'FAILED' }),
      data: expect.objectContaining({ status: 'DONE', lastError: null }),
    }));
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      entityType: 'PendingInboxNotification', entityId: 'pending-1',
      metadata: expect.objectContaining({ dedupeKey: 'pending:billing:conta-a:PAYMENT_RECEIVED:pay-legacy', previousError: 'Entidade local não encontrada após tentativas máximas' }),
    }) }));
  });

  it('fecha aviso de assinatura sem payment ao classificar subscription EXTERNAL e audita tenant', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{ ...eligibleRow, subscriptionId: 'sub-legacy' }] as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([{
      id: 'pending-subscription', dedupeKey: 'pending:billing:conta-a:SUBSCRIPTION_CREATED:sub-legacy',
      lastError: 'Entidade local não encontrada após tentativas máximas',
      payload: { asaasSubscriptionId: 'sub-legacy', asaasPaymentId: null },
    }] as never);

    const result = await classifyPreviewedExternalSubscription({
      contaId: 'conta-a', subscriptionId: 'sub-legacy', actorId: 'admin-a', reason: 'Assinatura legada externa', db: txMock as never,
    });

    expect(result.pendingInboxClosed).toBe(1);
    expect(txMock.pendingInboxNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', id: 'pending-subscription', status: 'FAILED' }),
      data: expect.objectContaining({ status: 'DONE' }),
    }));
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      contaId: 'conta-a', actorId: 'admin-a', entityId: 'pending-subscription',
      metadata: expect.objectContaining({ asaasSubscriptionId: 'sub-legacy', asaasPaymentId: null }),
    }) }));
  });

  it('keeps subscription-linked payment inbox open when a local payment owner exists', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{ ...eligibleRow, subscriptionId: 'sub-legacy' }] as never);
    vi.mocked(txMock.charge.findFirst).mockResolvedValueOnce({ id: 'charge-local' } as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([{
      id: 'pending-payment', dedupeKey: 'pending:billing:conta-a:PAYMENT_RECEIVED:pay-local',
      lastError: 'Entidade local não encontrada após tentativas máximas',
      payload: { asaasSubscriptionId: 'sub-legacy', asaasPaymentId: 'pay-local' },
    }] as never);

    const result = await classifyPreviewedExternalSubscription({
      contaId: 'conta-a', subscriptionId: 'sub-legacy', actorId: 'admin-a', reason: 'Assinatura legada externa', db: txMock as never,
    });

    expect(result.pendingInboxClosed).toBe(0);
    expect(txMock.pendingInboxNotification.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1); // only the origin classification audit
  });

  it('mantém FAILED inconsistente e fora do fechamento EXTERNAL', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{
      paymentId: 'pay-legacy', eventCount: 1, sampleExternalReferences: [], hasCanonicalReference: false,
      hasCharge: false, hasCobranca: false, hasPagamento: false, hasEventMapOrder: false,
      hasEventTicketSale: false, hasEventFinancialEntry: false, hasEventParticipant: false,
      hasEventBillingGroup: false, priorOrigin: null,
    }] as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([] as never);
    const result = await classifyPreviewedExternalPayment({
      contaId: 'conta-a', paymentId: 'pay-legacy', actorId: 'admin-a', reason: 'Pagamento legado da escola', db: txMock as never,
    });
    expect(result.pendingInboxClosed).toBe(0);
    expect(txMock.pendingInboxNotification.updateMany).not.toHaveBeenCalled();
    expect(txMock.pendingInboxNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      lastError: 'Entidade local não encontrada após tentativas máximas',
    }) }));
  });

  it('fecha pendência esgotada restante em classificação EXTERNAL repetida', async () => {
    vi.mocked(txMock.asaasResourceOrigin.findUnique).mockResolvedValue({
      id: 'origin-a', origin: 'EXTERNAL', reason: 'Pagamento legado da escola',
    } as never);
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{
      paymentId: 'pay-legacy', eventCount: 1, sampleExternalReferences: [], hasCanonicalReference: false,
      hasCharge: false, hasCobranca: false, hasPagamento: false, hasEventMapOrder: false,
      hasEventTicketSale: false, hasEventFinancialEntry: false, hasEventParticipant: false,
      hasEventBillingGroup: false, priorOrigin: 'EXTERNAL',
    }] as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([{
      id: 'pending-2', payload: { asaasPaymentId: 'pay-legacy' }, dedupeKey: 'pending:billing:legacy',
      lastError: 'Entidade local não encontrada após tentativas máximas',
    }] as never);
    const result = await classifyPreviewedExternalPayment({
      contaId: 'conta-a', paymentId: 'pay-legacy', actorId: 'admin-a', reason: 'Pagamento legado da escola', db: txMock as never,
    });
    expect(result).toMatchObject({ changed: false, pendingInboxClosed: 1 });
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
    expect(txMock.pendingInboxNotification.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  const exhaustedEventInboxRow = {
    id: 'pending-event', contaId: 'conta-a', kind: 'BILLING_WEBHOOK', status: 'FAILED',
    lastError: 'Entidade local não encontrada após tentativas máximas',
    dedupeKey: 'pending:billing:conta-a:PAYMENT_CONFIRMED:pay-event',
    payload: { asaasPaymentId: 'pay-event', asaasSubscriptionId: null },
  };

  it('fecha apenas inbox esgotado do pagamento de evento classificado ALUSA e audita os donos', async () => {
    vi.mocked(txMock.eventMapOrder.findFirst).mockResolvedValue({ id: 'event-order-a' } as never);
    vi.mocked(txMock.eventTicketSale.findFirst).mockResolvedValue({ id: 'ticket-sale-a', eventMapOrderId: 'event-order-a' } as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([exhaustedEventInboxRow] as never);

    const result = await classifyPaymentAsAlusaEvent();

    expect(result.pendingInboxClosed).toBe(1);
    expect(txMock.pendingInboxNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      contaId: 'conta-a', status: 'FAILED', payload: { path: ['asaasPaymentId'], equals: 'pay-event' },
    }) }));
    expect(txMock.pendingInboxNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', id: 'pending-event', status: 'FAILED' }),
      data: expect.objectContaining({ status: 'DONE', lastError: null }),
    }));
    expect(txMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      contaId: 'conta-a', actorId: 'admin-a', action: 'finance.pending_inbox.event_payment_resolved',
      entityId: 'pending-event', metadata: expect.objectContaining({
        resolution: 'EVENT_PAYMENT_NOTIFICATION_NOT_APPLICABLE', eventMapOrderId: 'event-order-a',
        eventTicketSaleId: 'ticket-sale-a', previousError: exhaustedEventInboxRow.lastError,
      }),
    }) }));
  });

  it('mantém inbox sem dono local de evento em FAILED', async () => {
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([exhaustedEventInboxRow] as never);
    await expect(classifyPaymentAsAlusaEvent()).rejects.toThrow('ALUSA exige vínculo local');
    expect(txMock.pendingInboxNotification.updateMany).not.toHaveBeenCalled();
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['charge', 'cobranca', 'pagamento'] as const)('não fecha inbox de evento quando também existe dono financeiro %s', async (delegateName) => {
    txMock[delegateName].findFirst.mockResolvedValue({ id: 'academic-owner' } as never);
    vi.mocked(txMock.eventMapOrder.findFirst).mockResolvedValue({ id: 'event-order-a' } as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([exhaustedEventInboxRow] as never);
    const result = await classifyPaymentAsAlusaEvent();
    expect(result.pendingInboxClosed).toBe(0);
    expect(txMock.pendingInboxNotification.updateMany).not.toHaveBeenCalled();
  });

  it('não fecha inbox quando venda aponta para outro EventMapOrder', async () => {
    vi.mocked(txMock.eventMapOrder.findFirst).mockResolvedValue({ id: 'event-order-a' } as never);
    vi.mocked(txMock.eventTicketSale.findFirst).mockResolvedValue({ id: 'ticket-sale-a', eventMapOrderId: 'event-order-b' } as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([exhaustedEventInboxRow] as never);
    const result = await classifyPaymentAsAlusaEvent();
    expect(result.pendingInboxClosed).toBe(0);
    expect(txMock.pendingInboxNotification.updateMany).not.toHaveBeenCalled();
  });

  it('escopa leitura e atualização do inbox e dos donos pelo tenant classificado', async () => {
    vi.mocked(txMock.eventTicketSale.findFirst).mockResolvedValue({ id: 'ticket-sale-a', eventMapOrderId: null } as never);
    vi.mocked(txMock.pendingInboxNotification.findMany).mockResolvedValueOnce([exhaustedEventInboxRow] as never);
    await classifyPaymentAsAlusaEvent();
    for (const delegateName of ['charge', 'cobranca', 'pagamento', 'eventMapOrder', 'eventTicketSale'] as const) {
      expect(txMock[delegateName].findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ contaId: 'conta-a' }) }));
    }
    expect(txMock.pendingInboxNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ contaId: 'conta-a' }) }));
  });

  async function classifyPaymentAsAlusaEvent() {
    return classifyAsaasResourceOrigin({
      contaId: 'conta-a', resourceType: 'PAYMENT', asaasId: 'pay-event', origin: 'ALUSA', actorId: 'admin-a', reason: 'Pagamento da venda do evento', db: txMock as never,
    });
  }

  it('revalidates a local Charge before external payment classification', async () => {
    vi.mocked(txMock.charge.findFirst).mockResolvedValue({ id: 'charge-a' } as never);
    await expect(classifyPreviewedExternalPayment({
      contaId: 'conta-a', paymentId: 'pay-avulso', actorId: 'admin-a', reason: 'Pagamento pertence à Alusa', db: txMock as never,
    })).rejects.toThrow('já possui vínculo local');
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
  });

  it.each([
    'pagamento', 'eventMapOrder', 'eventTicketSale', 'eventFinancialEntry', 'eventParticipant', 'eventBillingGroup',
  ] as const)('blocks external classification for local payment owner %s', async (delegateName) => {
    const delegate = txMock[delegateName];
    delegate.findFirst.mockResolvedValue({ id: 'local-payment' } as never);
    await expect(classifyPreviewedExternalPayment({
      contaId: 'conta-a', paymentId: 'pay-avulso', actorId: 'admin-a', reason: 'Pagamento local Alusa', db: txMock as never,
    })).rejects.toThrow('já possui vínculo local');
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
  });

  it('previews installment plans grouped by exact provider ID with bounded payment evidence', async () => {
    vi.mocked(txMock.$queryRaw)
      .mockResolvedValueOnce([{
        installmentId: 'inst-a', paymentCount: 4, samplePaymentIds: ['pay-a', 'pay-b'], sampleExternalReferences: ['school-plan-4'],
        hasCanonicalReference: false, hasAcademicInstallment: false, hasStandaloneInstallment: false,
        hasEventParticipant: false, hasEventBillingGroup: false, priorOrigin: null,
      }] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never);
    const preview = await previewExternalInstallmentCandidates({ contaId: 'conta-a', pageSize: 1, db: txMock as never });
    expect(preview.items[0]).toMatchObject({
      installmentId: 'inst-a', paymentCount: 4, samplePaymentIds: ['pay-a', 'pay-b'],
      sampleExternalReferences: ['school-plan-4'], eligible: true,
    });
  });

  it('revalidates local installment ownership and canonical references before classification', async () => {
    vi.mocked(txMock.$queryRaw).mockResolvedValueOnce([{
      installmentId: 'inst-a', paymentCount: 2, samplePaymentIds: [], sampleExternalReferences: [],
      hasCanonicalReference: true, hasAcademicInstallment: false, hasStandaloneInstallment: false,
      hasEventParticipant: false, hasEventBillingGroup: false, priorOrigin: null,
    }] as never);
    await expect(classifyPreviewedExternalInstallment({
      contaId: 'conta-a', installmentId: 'inst-a', actorId: 'admin-a', reason: 'Verificado fora da plataforma', db: txMock as never,
    })).rejects.toThrow('CANONICAL_ALUSA_REFERENCE');
    expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
  });

  it.each(['installmentPlan', 'standaloneInstallmentPlan', 'eventParticipant', 'eventBillingGroup'] as const)(
    'blocks external installment classification when %s owns the ID', async (delegateName) => {
      txMock[delegateName].findFirst.mockResolvedValue({ id: 'local-plan' } as never);
      await expect(classifyPreviewedExternalInstallment({
        contaId: 'conta-a', installmentId: 'inst-a', actorId: 'admin-a', reason: 'Plano local da escola', db: txMock as never,
      })).rejects.toThrow('já possui vínculo local');
      expect(txMock.asaasResourceOrigin.upsert).not.toHaveBeenCalled();
    },
  );
});
