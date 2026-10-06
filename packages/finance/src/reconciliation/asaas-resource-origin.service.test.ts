import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(), subscription: { findFirst: vi.fn() }, standaloneSubscription: { findFirst: vi.fn() },
  billingAgreement: { findFirst: vi.fn() }, matricula: { findFirst: vi.fn() }, enrollmentCreationOperation: { findFirst: vi.fn() },
  acordoFinanceiroFuturo: { findFirst: vi.fn() },
  webhookAsaas: { findFirst: vi.fn() }, asaasResourceOrigin: { findUnique: vi.fn(), upsert: vi.fn() },
  charge: { findFirst: vi.fn() }, cobranca: { findFirst: vi.fn() }, pagamento: { findFirst: vi.fn() },
  eventMapOrder: { findFirst: vi.fn() }, eventTicketSale: { findFirst: vi.fn() }, eventFinancialEntry: { findFirst: vi.fn() },
  eventParticipant: { findFirst: vi.fn() }, eventBillingGroup: { findFirst: vi.fn() }, auditLog: { create: vi.fn() },
  installmentPlan: { findFirst: vi.fn() }, standaloneInstallmentPlan: { findFirst: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@alusa/database', () => ({ prisma: prismaMock }));

import { prisma } from '@alusa/database';
import { classifyPreviewedExternalInstallment, classifyPreviewedExternalPayment, classifyPreviewedExternalSubscription, previewExternalInstallmentCandidates, previewExternalPaymentCandidates, previewExternalSubscriptionCandidates } from './asaas-resource-origin.service';

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
