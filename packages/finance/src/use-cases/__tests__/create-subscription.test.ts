import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSubscription } from '../create-subscription';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
      matricula: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      contrato: {
        findFirst: vi.fn(),
      },
      subscription: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  createSubscription: vi.fn(),
}));

vi.mock('../../foundation/feature-flags.service', () => ({
  featureFlagsService: {
    isEnabled: vi.fn(),
  },
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(async () => {}),
  },
}));

vi.mock('../../foundation/kyc-guard', () => ({
  requireKycApproved: vi.fn(),
}));

vi.mock('../ensure-customer', () => ({
  ensureCustomer: vi.fn(),
}));

describe('createSubscription', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { requireKycApproved } = await import('../../foundation/kyc-guard');
    vi.mocked(requireKycApproved).mockResolvedValue({ success: true, data: true } as never);

    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) =>
      callback({
        subscription: {
          create: prisma.subscription.create,
          update: prisma.subscription.update,
        },
        matricula: {
          update: prisma.matricula.update,
        },
      })
    );
  });

  it('deve bloquear quando enableSubscriptions está off', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(false);

    const res = await createSubscription({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      value: 150,
      nextDueDate: '2099-01-10',
      billingType: 'BOLETO',
      cycle: 'MONTHLY',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('FEATURE_DISABLED');
  });

  it('deve retornar conflito quando já existe Subscription com asaasSubscriptionId', async () => {
    const { prisma } = await import('@alusa/database');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);

    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1',
      alunoId: 'a1',
      responsavelFinanceiroId: 'r1',
      asaasSubscriptionId: 'asaas_sub_1',
    } as never);

    vi.mocked(prisma.contrato.findFirst).mockResolvedValueOnce({ id: 'c1' } as never);

    vi.mocked(prisma.subscription.findUnique).mockResolvedValueOnce({
      id: 's1',
      contratoId: 'c1',
      matriculaId: 'm1',
      externalReference: 'subscription:s1',
      asaasSubscriptionId: 'asaas_sub_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    const res = await createSubscription({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      value: 150,
      nextDueDate: '2099-01-10',
      billingType: 'BOLETO',
      cycle: 'MONTHLY',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('ASSINATURA_CONFLITANTE');
  });

  it('deve bloquear quando KYC não está aprovado', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { prisma } = await import('@alusa/database');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);
    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: false, error: 'KYC_NAO_APROVADO' } as never);

    const res = await createSubscription({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      value: 150,
      nextDueDate: '2099-01-10',
      billingType: 'BOLETO',
      cycle: 'MONTHLY',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('KYC_NAO_APROVADO');
    expect(prisma.matricula.findFirst).not.toHaveBeenCalled();
  });

  it('deve criar assinatura no Asaas e persistir asaasSubscriptionId', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createSubscription: asaasCreateSubscription } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);

    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1',
      alunoId: 'a1',
      responsavelFinanceiroId: 'r1',
      asaasSubscriptionId: null,
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);

    vi.mocked(prisma.contrato.findFirst).mockResolvedValueOnce({ id: 'c1' } as never);

    // Nenhuma subscription existente (byContrato + byMatricula)
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    vi.mocked(ensureCustomer).mockResolvedValueOnce({
      success: true,
      data: { customerId: 'asaas_cus_1', externalReference: 'financeProfile:fp1' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x', contaId: 't1' } as never);

    vi.mocked(asaasCreateSubscription).mockResolvedValueOnce({
      id: 'asaas_sub_1',
      status: 'ACTIVE',
      deleted: false,
    } as never);

    vi.mocked(prisma.subscription.create).mockResolvedValueOnce({
      id: 'sub_generated',
      externalReference: 'subscription:sub_generated',
      asaasSubscriptionId: 'asaas_sub_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    vi.mocked(prisma.matricula.update).mockResolvedValueOnce({} as never);

    const res = await createSubscription({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      value: 150,
      nextDueDate: '2099-01-10',
      billingType: 'BOLETO',
      cycle: 'MONTHLY',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);

    expect(asaasCreateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sandbox_x',
        data: expect.objectContaining({
          customer: 'asaas_cus_1',
          value: 150,
          nextDueDate: '2099-01-10',
          billingType: 'BOLETO',
          cycle: 'MONTHLY',
        }),
      }),
    );

    // Idempotency key deve respeitar limite de 47 chars do Asaas
    const call = vi.mocked(asaasCreateSubscription).mock.calls[0][0] as { idempotencyKey?: string };
    expect(call.idempotencyKey).toBeDefined();
    expect(call.idempotencyKey!.length).toBeLessThanOrEqual(47);
    expect(call.idempotencyKey).toMatch(/^idem_[a-f0-9]{40}$/);

    expect(prisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          asaasSubscriptionId: 'asaas_sub_1',
          status: 'ACTIVE',
        }),
      }),
    );

    expect(prisma.matricula.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { asaasSubscriptionId: 'asaas_sub_1' },
    });
  });

  it('deve enviar billingType CREDIT_CARD ao Asaas quando wizard solicitar CREDIT_CARD', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createSubscription: asaasCreateSubscription } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);

    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1',
      alunoId: 'a1',
      responsavelFinanceiroId: 'r1',
      asaasSubscriptionId: null,
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);

    vi.mocked(prisma.contrato.findFirst).mockResolvedValueOnce({ id: 'c1' } as never);
    vi.mocked(prisma.subscription.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    vi.mocked(ensureCustomer).mockResolvedValueOnce({
      success: true,
      data: { customerId: 'asaas_cus_1', externalReference: 'financeProfile:fp1' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x', contaId: 't1' } as never);

    vi.mocked(asaasCreateSubscription).mockResolvedValueOnce({
      id: 'asaas_sub_1',
      status: 'ACTIVE',
      deleted: false,
    } as never);

    vi.mocked(prisma.subscription.create).mockResolvedValueOnce({
      id: 'sub_generated',
      externalReference: 'subscription:sub_generated',
      asaasSubscriptionId: 'asaas_sub_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    vi.mocked(prisma.matricula.update).mockResolvedValueOnce({} as never);

    const res = await createSubscription({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      value: 150,
      nextDueDate: '2099-01-10',
      billingType: 'CREDIT_CARD',
      cycle: 'MONTHLY',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);

    expect(asaasCreateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sandbox_x',
        data: expect.objectContaining({
          billingType: 'CREDIT_CARD',
        }),
      }),
    );
  });
});
