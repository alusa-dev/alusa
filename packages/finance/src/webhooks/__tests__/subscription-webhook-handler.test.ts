import { describe, it, expect, vi, beforeEach } from 'vitest';

const issueMocks = vi.hoisted(() => ({ upsertFinanceReconciliationIssue: vi.fn(async () => ({ id: 'issue-subscription' })) }));

vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => issueMocks);

import { handleSubscriptionWebhook } from '../subscription-webhook-handler';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      subscription: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      asaasResourceOrigin: { findUnique: vi.fn(async () => null) },
      standaloneSubscription: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      billingAgreement: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
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

  it('deve retornar sucesso quando não encontra Subscription', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE', externalReference: 'subscription:s1' },
    });

    expect(res).toEqual({ success: true });
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
