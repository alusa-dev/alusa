import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSubscriptionWebhook } from '../subscription-webhook-handler';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      subscription: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      standaloneSubscription: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      billingAgreement: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      rematriculaFamiliar: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      matricula: {
        findUnique: vi.fn(),
        update: vi.fn(),
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
    expect(prisma.matricula.update).not.toHaveBeenCalled();
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
    vi.mocked(prisma.matricula.update).mockResolvedValueOnce({} as never);

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

    expect(prisma.matricula.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
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
    vi.mocked(prisma.matricula.update).mockResolvedValue({} as never);
    vi.mocked(prisma.matricula.findUnique).mockResolvedValue({ status: 'ATIVA' } as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_DELETED',
      subscription: { id: 'asaas_sub_1', deleted: true },
    });

    expect(res.success).toBe(true);

    // Verifica que matrícula foi atualizada para CANCELADA (segunda chamada)
    expect(prisma.matricula.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: { status: 'CANCELADA' },
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
    vi.mocked(prisma.matricula.findUnique).mockResolvedValueOnce({ status: 'ATIVA', pausaAtiva: false, integrationStatus: 'SINCRONIZADO' } as never);
    vi.mocked(prisma.matricula.update).mockResolvedValue({} as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_INACTIVATED',
      subscription: { id: 'asaas_sub_1', status: 'INACTIVE' },
    });

    expect(res.success).toBe(true);

    // Verifica que matrícula foi pausada com todos os campos novos
    expect(prisma.matricula.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
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
    vi.mocked(prisma.matricula.findUnique).mockResolvedValueOnce({ status: 'PAUSADA', pausaAtiva: true, integrationStatus: 'PENDENTE_SINCRONISMO' } as never);
    vi.mocked(prisma.matricula.update).mockResolvedValue({} as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE' },
    });

    expect(res.success).toBe(true);

    // Verifica que matrícula foi reativada com todos os campos novos
    expect(prisma.matricula.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
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
    vi.mocked(prisma.matricula.findUnique).mockResolvedValueOnce({ status: 'CANCELADA' } as never);
    vi.mocked(prisma.matricula.update).mockResolvedValue({} as never);

    await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE' },
    });

    // Só deve ter sido chamado 1x (para setar asaasSubscriptionId), não para mudar status
    const updateCalls = vi.mocked(prisma.matricula.update).mock.calls;
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
    vi.mocked(prisma.matricula.findUnique).mockResolvedValueOnce({
      status: 'PAUSADA',
      pausaAtiva: true,
      integrationStatus: 'PENDENTE_SINCRONISMO',
    } as never);
    vi.mocked(prisma.matricula.update).mockResolvedValue({} as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_INACTIVATED',
      subscription: { id: 'asaas_sub_1', status: 'INACTIVE' },
    });

    expect(res.success).toBe(true);

    // Deve apenas confirmar integrationStatus sem mudar status da matrícula
    expect(prisma.matricula.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
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
    vi.mocked(prisma.matricula.findUnique).mockResolvedValueOnce({
      status: 'ATIVA',
      pausaAtiva: false,
      integrationStatus: 'PENDENTE_SINCRONISMO',
    } as never);
    vi.mocked(prisma.matricula.update).mockResolvedValue({} as never);

    const res = await handleSubscriptionWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'asaas_sub_1', status: 'ACTIVE' },
    });

    expect(res.success).toBe(true);

    expect(prisma.matricula.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
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
