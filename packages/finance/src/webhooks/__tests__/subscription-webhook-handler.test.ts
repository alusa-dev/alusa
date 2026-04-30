import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSubscriptionWebhook } from '../subscription-webhook-handler';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      subscription: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      matricula: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      matriculaOperacao: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    },
  };
});

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

describe('handleSubscriptionWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
