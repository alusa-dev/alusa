import { describe, it, expect, vi, beforeEach } from 'vitest';

const issueMocks = vi.hoisted(() => ({ upsertFinanceReconciliationIssue: vi.fn(async () => ({ id: 'issue-subscription' })) }));

vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => issueMocks);

import { handleSubscriptionWebhook } from '../subscription-webhook-handler';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      conta: { findUnique: vi.fn(async () => ({ financeIntegrationMode: 'WHITELABEL_BAAS' })) },
      subscription: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      asaasResourceOrigin: { findUnique: vi.fn(async () => null) },
      financeReconciliationIssue: { findFirst: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
      standaloneSubscription: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      billingAgreement: {
        findFirst: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      acordoFinanceiroFuturo: { findFirst: vi.fn() },
      asaasIntegrationJob: {
        findMany: vi.fn(async () => []),
      },
      rematriculaFamiliar: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      matricula: {
        findFirst: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      matriculaOperacao: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      enrollmentCreationOperation: {
        findFirst: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      acordoFinanceiroFuturo: { findFirst: vi.fn() },
    },
  };
});

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

vi.mock('../../realtime/finance-realtime-publisher', () => ({
  publishFinanceEvent: vi.fn(async () => {}),
}));

describe('handleSubscriptionWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignora assinatura criada no painel sem vínculo no modo conta externa', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.conta.findUnique).mockResolvedValueOnce({ financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT' } as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_CREATED', eventId: 'evt-panel-sub',
      subscription: { id: 'sub-panel', status: 'ACTIVE', externalReference: 'referencia-arbitraria' },
    });

    expect(result).toEqual({ success: true });
    expect(prisma.billingAgreement.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(issueMocks.upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
  });

  it.each([
    ['Subscription', 'subscription', 'subscription-local'],
    ['StandaloneSubscription', 'standaloneSubscription', 'standalone-local'],
    ['BillingAgreement', 'billingAgreement', 'billing-agreement-local'],
    ['Matricula', 'matricula', 'matricula-local'],
    ['EnrollmentCreationOperation', 'enrollmentCreationOperation', 'enrollment-operation-local'],
    ['AcordoFinanceiroFuturo', 'acordoFinanceiroFuturo', 'future-agreement-local'],
  ] as const)('gera alerta HIGH sem mutação para origin EXTERNAL vinculado a %s', async (_label, modelName, entityId) => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce({ origin: 'EXTERNAL' } as never);
    const model = prisma[modelName] as { findFirst: ReturnType<typeof vi.fn> };
    model.findFirst.mockResolvedValueOnce({ id: entityId } as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED', eventId: `evt-conflict-${entityId}`,
      subscription: { id: 'sub-shared', status: 'INACTIVE' },
    });

    expect(result).toEqual({ success: true });
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { contaId: 'conta-a', asaasSubscriptionId: 'sub-shared' }, select: { id: true },
    });
    expect(prisma.billingAgreement.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.standaloneSubscription.update).not.toHaveBeenCalled();
    expect(prisma.matricula.updateMany).not.toHaveBeenCalled();
    expect(prisma.enrollmentCreationOperation.updateMany).not.toHaveBeenCalled();
    expect(issueMocks.upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', entityId, asaasId: 'sub-shared', severity: 'HIGH',
      metadata: expect.objectContaining({ reason: 'external_origin_conflicts_with_local_subscription' }),
    }));
  });

  it('não muta assinatura local quando origin EXTERNAL conflita com referência canônica', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce({ origin: 'EXTERNAL' } as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED', eventId: 'evt-canonical-external',
      subscription: {
        id: 'sub-canonical-external', status: 'ACTIVE',
        externalReference: 'alusa:subscription:mat-a:plan-a',
      },
    });

    expect(result).toEqual({ success: true });
    expect(prisma.billingAgreement.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(issueMocks.upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', asaasId: 'sub-canonical-external', severity: 'HIGH',
      metadata: expect.objectContaining({ reason: 'canonical_alusa_reference_classified_external' }),
    }));
  });

  it('persiste triagem idempotente quando assinatura UNKNOWN não possui referência local', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce(null as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_CREATED',
      eventId: 'evt-sub-unknown',
      subscription: { id: 'sub-unknown', status: 'ACTIVE', externalReference: 'school-reference-unknown' },
    });

    expect(result).toEqual({ success: true });
    expect(issueMocks.upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', entityType: 'SUBSCRIPTION', asaasId: 'sub-unknown',
      issueType: 'SUBSCRIPTION_NEEDS_REVIEW', severity: 'MEDIUM', causeId: 'evt-sub-unknown',
      metadata: expect.objectContaining({ reason: 'resource_origin_unknown' }),
    }));
  });

  it('ignora assinatura sem vínculo no modo conta Asaas externa', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.conta.findUnique).mockResolvedValueOnce({ financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT' } as never);
    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_CREATED',
      eventId: 'evt-panel-sub',
      subscription: { id: 'sub-panel', status: 'ACTIVE', externalReference: 'school-reference' },
    });
    expect(result).toEqual({ success: true });
    expect(issueMocks.upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
  });

  it('bloqueia origem EXTERNAL em conflito com referência Alusa sem projetar nem mutar subscription local', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce({ origin: 'EXTERNAL' } as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'subscription-local-conflict', billingAgreementId: 'agreement-local', status: 'ACTIVE',
      asaasSubscriptionId: 'sub-conflict', externalReference: 'alusa:subscription:mat-a:plan-a', matriculaId: 'mat-a',
    } as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED', eventId: 'evt-sub-conflict',
      subscription: { id: 'sub-conflict', status: 'INACTIVE', externalReference: 'alusa:subscription:mat-a:plan-a' },
    });

    expect(result).toEqual({ success: true });
    expect(prisma.billingAgreement.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(issueMocks.upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', entityType: 'SUBSCRIPTION', asaasId: 'sub-conflict', severity: 'HIGH',
      metadata: expect.objectContaining({ reason: 'canonical_alusa_reference_classified_external' }),
    }));
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null as never);
  });

  it('mantém alerta HIGH para referência Alusa sem entidade local', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce(null as never);

    await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_CREATED',
      eventId: 'evt-sub-broken-link',
      subscription: { id: 'sub-broken-link', status: 'ACTIVE', externalReference: 'alusa:subscription:mat-a:plan-a' },
    });

    expect(issueMocks.upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', entityType: 'SUBSCRIPTION', asaasId: 'sub-broken-link',
      issueType: 'SUBSCRIPTION_NEEDS_REVIEW', severity: 'HIGH', causeId: 'evt-sub-broken-link',
      metadata: expect.objectContaining({ reason: 'alusa_reference_without_local_entity' }),
    }));
  });

  it('não cria pendência para assinatura já classificada como EXTERNAL', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce({ origin: 'EXTERNAL' } as never);

    await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED',
      eventId: 'evt-sub-external',
      subscription: { id: 'sub-external', status: 'ACTIVE' },
    });

    expect(issueMocks.upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
  });

  it('mantém vínculo local em revisão quando uma assinatura está classificada como EXTERNAL', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce({ origin: 'EXTERNAL' } as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 'subscription-local-1',
      billingAgreementId: 'agreement-local-1',
      status: 'ACTIVE',
      asaasSubscriptionId: 'sub-external-linked',
      externalReference: null,
      matriculaId: null,
    } as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED',
      eventId: 'evt-sub-external-linked',
      subscription: { id: 'sub-external-linked', status: 'INACTIVE' },
    });

    expect(result).toEqual({ success: true });
    expect(prisma.billingAgreement.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { contaId: 'conta-a', asaasSubscriptionId: 'sub-external-linked' },
      select: { id: true },
    });
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(issueMocks.upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', entityType: 'SUBSCRIPTION', entityId: 'subscription-local-1',
      asaasId: 'sub-external-linked', severity: 'HIGH',
      metadata: expect.objectContaining({ reason: 'external_origin_conflicts_with_local_subscription' }),
    }));
  });

  it.each([
    ['Matricula', 'matricula', 'matricula-local-1'],
    ['EnrollmentCreationOperation', 'enrollmentCreationOperation', 'enrollment-op-local-1'],
    ['AcordoFinanceiroFuturo', 'acordoFinanceiroFuturo', 'future-agreement-local-1'],
  ] as const)('registra conflito HIGH sem mutação quando origin EXTERNAL tem vínculo local em %s', async (_label, modelName, entityId) => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce({ origin: 'EXTERNAL' } as never);
    const model = prisma[modelName] as { findFirst: ReturnType<typeof vi.fn> };
    model.findFirst.mockResolvedValueOnce({ id: entityId } as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED',
      eventId: `evt-external-${entityId}`,
      subscription: { id: 'sub-mapped-local', status: 'INACTIVE' },
    });

    expect(result).toEqual({ success: true });
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { contaId: 'conta-a', asaasSubscriptionId: 'sub-mapped-local' },
      select: { id: true },
    });
    expect(prisma.billingAgreement.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect(prisma.standaloneSubscription.update).not.toHaveBeenCalled();
    expect(prisma.matricula.updateMany).not.toHaveBeenCalled();
    expect(prisma.enrollmentCreationOperation.updateMany).not.toHaveBeenCalled();
    expect(issueMocks.upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', entityType: 'SUBSCRIPTION', entityId, asaasId: 'sub-mapped-local', severity: 'HIGH',
      metadata: expect.objectContaining({ reason: 'external_origin_conflicts_with_local_subscription' }),
    }));
  });

  it('resolve review de origem desconhecida após projetar BillingAgreement local classificado ALUSA', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValueOnce({ origin: 'ALUSA' } as never);
    vi.mocked(prisma.billingAgreement.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.financeReconciliationIssue.findFirst).mockResolvedValueOnce({ id: 'review-agreement' } as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED',
      eventId: 'evt-agreement-only',
      subscription: { id: 'sub-agreement-only', status: 'ACTIVE' },
    });

    expect(result).toEqual({ success: true });
    expect(prisma.billingAgreement.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-a', asaasSubscriptionId: 'sub-agreement-only' },
      data: expect.objectContaining({ remoteStatus: 'ACTIVE' }),
    }));
    expect(prisma.financeReconciliationIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'review-agreement', contaId: 'conta-a', status: 'OPEN' }),
      data: expect.objectContaining({ status: 'RESOLVED' }),
    }));
    expect(issueMocks.upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
  });

  it('registra assinatura na saga sem publicar entidade quando webhook chega antes do commit', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockResolvedValueOnce({
      id: 'op-1',
      status: 'PROCESSING',
    } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_CREATED',
      subscription: {
        id: 'asaas-sub-1',
        status: 'ACTIVE',
        externalReference: 'enrollment-op:op-1:subscription',
      },
    });

    expect(res).toEqual({
      success: false,
      error: 'ENROLLMENT_CREATION_IN_PROGRESS',
    });
    expect(prisma.enrollmentCreationOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 'op-1', contaId: 't1' },
      data: { asaasSubscriptionId: 'asaas-sub-1' },
    });
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('processa normalmente quando o commit local terminou antes da saga ser marcada como concluída', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockResolvedValueOnce({
      id: 'op-1',
      status: 'REMOTE_PROVISIONED',
    } as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: 'subscription-local-1',
      status: 'ACTIVE',
      matriculaId: null,
    } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: {
        id: 'asaas-sub-1',
        status: 'ACTIVE',
        externalReference: 'enrollment-op:op-1:subscription',
      },
    });

    expect(res).toEqual({ success: true });
    expect(prisma.enrollmentCreationOperation.updateMany).not.toHaveBeenCalled();
    expect(prisma.subscription.update).toHaveBeenCalled();
  });

  it('reprocessa webhook staged após commit local da saga e aplica estado apenas uma vez', async () => {
    const { prisma } = await import('@alusa/database');
    const operation = { id: 'op-saga-replay', status: 'PROCESSING', asaasSubscriptionId: null as string | null };
    const subscriptionRow: {
      id: string;
      status: string;
      asaasSubscriptionId: string | null;
      externalReference: string;
      matriculaId: string | null;
      billingAgreementId: string | null;
    } = {
      id: 'subscription-saga-replay',
      status: 'REQUESTED',
      asaasSubscriptionId: null,
      externalReference: 'enrollment-op:op-saga-replay:subscription',
      matriculaId: null,
      billingAgreementId: null,
    };

    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockImplementation(async () => operation as never);
    vi.mocked(prisma.enrollmentCreationOperation.updateMany).mockImplementation(async ({ data }) => {
      operation.asaasSubscriptionId = data.asaasSubscriptionId ?? null;
      return { count: 1 } as never;
    });
    vi.mocked(prisma.subscription.findFirst).mockImplementation(async ({ where }) => {
      if ('asaasSubscriptionId' in where) {
        return subscriptionRow.asaasSubscriptionId === where.asaasSubscriptionId
          ? { id: subscriptionRow.id } as never
          : null as never;
      }
      return subscriptionRow as never;
    });
    vi.mocked(prisma.subscription.update).mockImplementation(async ({ data }) => {
      Object.assign(subscriptionRow, data);
      return subscriptionRow as never;
    });

    const webhook = {
      event: 'SUBSCRIPTION_CREATED',
      eventId: 'evt-saga-replay',
      subscription: {
        id: 'asaas-sub-saga-replay',
        status: 'ACTIVE',
        externalReference: 'enrollment-op:op-saga-replay:subscription',
      },
    };

    const beforeCommit = await handleSubscriptionWebhook('conta-saga', webhook);
    expect(beforeCommit).toEqual({ success: false, error: 'ENROLLMENT_CREATION_IN_PROGRESS' });
    expect(operation.asaasSubscriptionId).toBe('asaas-sub-saga-replay');
    expect(prisma.subscription.update).not.toHaveBeenCalled();

    // The enrollment transaction commits its local Subscription and marks the
    // saga provisioned after the webhook has safely staged the provider ID.
    operation.status = 'REMOTE_PROVISIONED';
    subscriptionRow.asaasSubscriptionId = operation.asaasSubscriptionId;

    const replay = await handleSubscriptionWebhook('conta-saga', webhook);
    const duplicateReplay = await handleSubscriptionWebhook('conta-saga', webhook);

    expect(replay).toEqual({ success: true });
    expect(duplicateReplay).toEqual({ success: true });
    expect(subscriptionRow).toMatchObject({ status: 'ACTIVE', asaasSubscriptionId: 'asaas-sub-saga-replay' });
    expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'subscription-saga-replay' },
      data: expect.objectContaining({ status: 'ACTIVE' }),
    }));
    expect(prisma.enrollmentCreationOperation.updateMany).toHaveBeenCalledTimes(1);
    expect(issueMocks.upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockReset();
    vi.mocked(prisma.enrollmentCreationOperation.updateMany).mockReset();
    vi.mocked(prisma.subscription.findFirst).mockReset();
    vi.mocked(prisma.subscription.update).mockReset();
  });

  it('deve retornar sucesso quando não encontra Subscription', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE', externalReference: 'subscription:s1' },
    });

    expect(res).toEqual({ success: true });
  });

  it('resolve a issue de origem desconhecida somente após replay bem-sucedido do evento correlacionado', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 'subscription-local-1', status: 'ACTIVE', asaasSubscriptionId: 'sub-replay',
      externalReference: null, matriculaId: null, billingAgreementId: null,
    } as never);
    vi.mocked(prisma.financeReconciliationIssue.findFirst).mockResolvedValueOnce({ id: 'review-sub-replay' } as never);

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED', eventId: 'evt-sub-replay',
      subscription: { id: 'sub-replay', status: 'ACTIVE' },
    });

    expect(result).toEqual({ success: true });
    expect(prisma.financeReconciliationIssue.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'conta-a', asaasId: 'sub-replay', status: 'OPEN',
        AND: [
          { metadata: { path: ['reason'], equals: 'resource_origin_unknown' } },
          { metadata: { path: ['lastCauseId'], equals: 'evt-sub-replay' } },
        ],
      }),
    }));
    expect(prisma.financeReconciliationIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'review-sub-replay', contaId: 'conta-a', status: 'OPEN',
        AND: [
          { metadata: { path: ['reason'], equals: 'resource_origin_unknown' } },
          { metadata: { path: ['lastCauseId'], equals: 'evt-sub-replay' } },
        ],
      }),
      data: expect.objectContaining({ status: 'RESOLVED' }),
    }));
  });

  it('mantém a issue aberta quando o replay do webhook falha', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 'subscription-local-1', status: 'REQUESTED', asaasSubscriptionId: null,
      externalReference: null, matriculaId: null, billingAgreementId: null,
    } as never);
    vi.mocked(prisma.subscription.update).mockRejectedValueOnce(new Error('persistência indisponível'));

    const result = await handleSubscriptionWebhook('conta-a', {
      event: 'SUBSCRIPTION_UPDATED', eventId: 'evt-sub-failed',
      subscription: { id: 'sub-replay', status: 'ACTIVE' },
    });

    expect(result.success).toBe(false);
    expect(prisma.financeReconciliationIssue.findFirst).not.toHaveBeenCalled();
    expect(prisma.financeReconciliationIssue.updateMany).not.toHaveBeenCalled();
  });

  it('roteia StandaloneSubscription familiar sem atualizar matrícula individual', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.standaloneSubscription.findFirst).mockResolvedValueOnce({
      id: 'standalone_1',
      status: 'REQUESTED',
      asaasSubscriptionId: null,
      externalReference: 'standalone-subscription:family',
      familyGroupId: 'remat_fam_1',
      familyTransitionId: null,
    } as never);
    vi.mocked(prisma.standaloneSubscription.update).mockResolvedValueOnce({} as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_CREATED',
      subscription: {
        id: 'asaas_sub_family',
        status: 'ACTIVE',
        externalReference: 'standalone-subscription:family',
      },
    });

    expect(res.success).toBe(true);
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.matricula.updateMany).not.toHaveBeenCalled();
    expect(prisma.rematriculaFamiliar.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'remat_fam_1',
          contaId: 't1',
          standaloneSubscriptionId: 'standalone_1',
        }),
        data: { targetBillingStatus: 'CONFIRMED' },
      }),
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.standalone_subscription_status_changed',
        entity: { type: 'StandaloneSubscription', id: 'standalone_1' },
      }),
    );
  });

  it('deve atualizar status e setar asaasSubscriptionId quando necessário', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 's1',
      status: 'REQUESTED',
      asaasSubscriptionId: null,
      externalReference: 'subscription:s1',
      matriculaId: 'm1',
    } as never);

    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.matricula.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE', externalReference: 'subscription:s1' },
    });

    expect(res.success).toBe(true);

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: expect.objectContaining({
        asaasSubscriptionId: 'asaas_sub_1',
        status: 'ACTIVE',
        statusUpdatedAt: expect.any(Date),
      }),
    });

    expect(prisma.matricula.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', contaId: 't1' },
      data: { asaasSubscriptionId: 'asaas_sub_1' },
    });

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 't1',
        action: 'finance.webhook.subscription_status_changed',
        entity: { type: 'Subscription', id: 's1' },
      }),
    );
  });

  it('deve cancelar matrícula quando assinatura é deletada', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 's1',
      status: 'ACTIVE',
      asaasSubscriptionId: 'asaas_sub_1',
      externalReference: 'subscription:s1',
      matriculaId: 'm1',
    } as never);

    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.matricula.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValue({ status: 'ATIVA' } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_DELETED',
      subscription: { id: 'asaas_sub_1', deleted: true },
    });

    expect(res.success).toBe(true);

    // Verifica que matrícula foi atualizada para CANCELADA (segunda chamada)
    expect(prisma.matricula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'm1', contaId: 't1', status: 'ATIVA' }),
        data: expect.objectContaining({ status: 'CANCELADA', cancelledAt: expect.any(Date) }),
      }),
    );

    // Verifica auditoria específica para cancelamento
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.matricula_cancelada_via_subscription',
        entity: { type: 'Matricula', id: 'm1' },
      }),
    );
  });

  it('não atualiza nem audita matrícula de outro tenant vinculada à assinatura', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 's-tenant-a',
      status: 'ACTIVE',
      asaasSubscriptionId: 'asaas_sub_1',
      externalReference: 'subscription:s1',
      matriculaId: 'm-tenant-b',
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.matricula.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_DELETED',
      subscription: { id: 'asaas_sub_1', deleted: true },
    });

    expect(res.success).toBe(true);
    expect(prisma.matricula.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.matricula.updateMany).toHaveBeenCalledWith({
      where: { id: 'm-tenant-b', contaId: 't1' },
      data: { asaasSubscriptionId: 'asaas_sub_1' },
    });
    expect(prisma.matricula.findFirst).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalledWith(
      expect.objectContaining({
        entity: { type: 'Matricula', id: 'm-tenant-b' },
      }),
    );
  });

  it('deve pausar matrícula ativa quando assinatura é inativada', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 's1',
      status: 'ACTIVE',
      asaasSubscriptionId: 'asaas_sub_1',
      externalReference: 'subscription:s1',
      matriculaId: 'm1',
    } as never);

    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({ status: 'ATIVA', pausaAtiva: false, integrationStatus: 'SINCRONIZADO' } as never);
    vi.mocked(prisma.matricula.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_INACTIVATED',
      subscription: { id: 'asaas_sub_1', status: 'INACTIVE' },
    });

    expect(res.success).toBe(true);

    // Verifica que matrícula foi pausada com todos os campos novos
    expect(prisma.matricula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'm1', contaId: 't1', status: 'ATIVA' }),
        data: expect.objectContaining({
          status: 'PAUSADA',
          pausaAtiva: true,
          integrationStatus: 'SINCRONIZADO',
          warningCode: null,
        }),
      }),
    );

    // Verifica consolidação de operações pendentes
    expect(prisma.matriculaOperacao.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matriculaId: 'm1',
          tipo: 'PAUSA',
          status: 'PENDENTE_SINCRONISMO',
        }),
        data: expect.objectContaining({
          status: 'SINCRONIZADO',
        }),
      }),
    );

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.matricula_pausada_via_subscription',
      }),
    );
  });

  it('deve reativar matrícula pausada quando assinatura é reativada', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 's1',
      status: 'INACTIVE',
      asaasSubscriptionId: 'asaas_sub_1',
      externalReference: 'subscription:s1',
      matriculaId: 'm1',
    } as never);

    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({ status: 'PAUSADA', pausaAtiva: true, integrationStatus: 'PENDENTE_SINCRONISMO' } as never);
    vi.mocked(prisma.matricula.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE' },
    });

    expect(res.success).toBe(true);

    // Verifica que matrícula foi reativada com todos os campos novos
    expect(prisma.matricula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'm1', contaId: 't1', status: 'PAUSADA' }),
        data: expect.objectContaining({
          status: 'ATIVA',
          pausaAtiva: false,
          integrationStatus: 'SINCRONIZADO',
          warningCode: null,
        }),
      }),
    );

    // Verifica consolidação de operações de reativação pendentes
    expect(prisma.matriculaOperacao.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matriculaId: 'm1',
          tipo: 'REATIVACAO',
          status: 'PENDENTE_SINCRONISMO',
        }),
        data: expect.objectContaining({
          status: 'SINCRONIZADO',
        }),
      }),
    );

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.matricula_reativada_via_subscription',
      }),
    );
  });

  it('não deve alterar matrícula cancelada quando assinatura é reativada', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 's1',
      status: 'INACTIVE',
      asaasSubscriptionId: 'asaas_sub_1',
      externalReference: 'subscription:s1',
      matriculaId: 'm1',
    } as never);

    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as never);
    // Matrícula já está cancelada - não deve ser reativada
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({ status: 'CANCELADA' } as never);
    vi.mocked(prisma.matricula.updateMany).mockResolvedValue({ count: 1 } as never);

    await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE' },
    });

    // Só deve ter sido chamado 1x (para setar asaasSubscriptionId), não para mudar status
    const updateCalls = vi.mocked(prisma.matricula.updateMany).mock.calls;
    const statusChangeCalls = updateCalls.filter((call) => 'status' in (call[0].data as Record<string, unknown>));
    expect(statusChangeCalls).toHaveLength(0);
  });

  it('deve confirmar sincronização quando matrícula já está PAUSADA com PENDENTE_SINCRONISMO', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 's1',
      status: 'ACTIVE',
      asaasSubscriptionId: 'asaas_sub_1',
      externalReference: 'subscription:s1',
      matriculaId: 'm1',
    } as never);

    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      status: 'PAUSADA',
      pausaAtiva: true,
      integrationStatus: 'PENDENTE_SINCRONISMO',
    } as never);
    vi.mocked(prisma.matricula.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_INACTIVATED',
      subscription: { id: 'asaas_sub_1', status: 'INACTIVE' },
    });

    expect(res.success).toBe(true);

    // Deve apenas confirmar integrationStatus sem mudar status da matrícula
    expect(prisma.matricula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'm1', contaId: 't1', status: 'PAUSADA' }),
        data: { integrationStatus: 'SINCRONIZADO', warningCode: null },
      }),
    );

    expect(prisma.matriculaOperacao.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matriculaId: 'm1',
          tipo: 'PAUSA',
          status: 'PENDENTE_SINCRONISMO',
        }),
      }),
    );

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.pausa_confirmada',
      }),
    );
  });

  it('deve confirmar sincronização quando matrícula já está ATIVA com PENDENTE_SINCRONISMO na reativação', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 's1',
      status: 'INACTIVE',
      asaasSubscriptionId: 'asaas_sub_1',
      externalReference: 'subscription:s1',
      matriculaId: 'm1',
    } as never);

    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      status: 'ATIVA',
      pausaAtiva: false,
      integrationStatus: 'PENDENTE_SINCRONISMO',
    } as never);
    vi.mocked(prisma.matricula.updateMany).mockResolvedValue({ count: 1 } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE' },
    });

    expect(res.success).toBe(true);

    expect(prisma.matricula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'm1', contaId: 't1', status: 'ATIVA' }),
        data: { integrationStatus: 'SINCRONIZADO', warningCode: null },
      }),
    );

    expect(prisma.matriculaOperacao.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matriculaId: 'm1',
          tipo: 'REATIVACAO',
          status: 'PENDENTE_SINCRONISMO',
        }),
      }),
    );

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.reativacao_confirmada',
      }),
    );
  });
});
