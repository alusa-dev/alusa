import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createSubscription,
  isCompatibleSubscriptionNextDueDate,
} from '../create-subscription';

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
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      asaasIntegrationJob: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  createSubscription: vi.fn(),
}));

vi.mock('../asaas-ops', () => ({
  getSubscription: vi.fn(),
  listSubscriptions: vi.fn(async () => ({ data: [] })),
}));

vi.mock('../outbound-financial-operation', () => ({
  reserveOutboundFinancialOperation: vi.fn(async () => ({
    job: { id: 'job-1' },
    payload: { remoteId: null },
  })),
  markOutboundRemoteRequested: vi.fn(async () => true),
  markOutboundRemoteConfirmed: vi.fn(),
  markOutboundAwaitingWebhook: vi.fn(),
  markOutboundResultUnknown: vi.fn(),
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

vi.mock('../../billing-agreements/materialize', () => ({
  materializeBillingAgreement: vi.fn(async () => ({ id: 'agreement-1' })),
}));

describe('createSubscription', () => {
  it('aceita nextDueDate avançado exatamente um ciclo após materializar o primeiro pagamento', () => {
    expect(
      isCompatibleSubscriptionNextDueDate({
        requestedNextDueDate: '2026-08-05',
        remoteNextDueDate: '2026-09-05',
        cycle: 'MONTHLY',
      }),
    ).toBe(true);

    expect(
      isCompatibleSubscriptionNextDueDate({
        requestedNextDueDate: '2026-08-05',
        remoteNextDueDate: '2026-10-05',
        cycle: 'MONTHLY',
      }),
    ).toBe(false);
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const { requireKycApproved } = await import('../../foundation/kyc-guard');
    vi.mocked(requireKycApproved).mockResolvedValue({ success: true, data: true } as never);

    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
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

  it('deve recuperar idempotentemente Subscription que já possui asaasSubscriptionId', async () => {
    const { prisma } = await import('@alusa/database');
    const { createSubscription: asaasCreateSubscription } = await import('@alusa/asaas');
    const { materializeBillingAgreement } = await import('../../billing-agreements/materialize');

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

    expect(res.success).toBe(true);
    if (res.success) expect(res.data.asaasSubscriptionId).toBe('asaas_sub_1');
    expect(asaasCreateSubscription).not.toHaveBeenCalled();
    expect(materializeBillingAgreement).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'INDIVIDUAL',
        contaId: 't1',
        subscriptionId: 's1',
      }),
    );
  });

  it('expõe falha específica e recuperável quando o BillingAgreement não materializa', async () => {
    const { prisma } = await import('@alusa/database');
    const { createSubscription: asaasCreateSubscription } = await import('@alusa/asaas');
    const { materializeBillingAgreement } = await import('../../billing-agreements/materialize');

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
    vi.mocked(materializeBillingAgreement).mockRejectedValueOnce(
      new Error('CUSTOMER_LOCAL_NAO_ENCONTRADO'),
    );

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

    expect(res).toEqual({
      success: false,
      error: 'BILLING_AGREEMENT_MATERIALIZATION_FAILED',
    });
    expect(asaasCreateSubscription).not.toHaveBeenCalled();
  });

  it('deve bloquear quando KYC não está aprovado', async () => {
    const { prisma } = await import('@alusa/database');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');

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
    const { getSubscription } = await import('../asaas-ops');
    const { ensureCustomer } = await import('../ensure-customer');
    const { materializeBillingAgreement } = await import('../../billing-agreements/materialize');

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
    vi.mocked(getSubscription).mockResolvedValueOnce({
      id: 'asaas_sub_1',
      status: 'ACTIVE',
      deleted: false,
      externalReference: 'alusa:subscription:m1:c1',
    } as never);

    vi.mocked(prisma.subscription.create).mockResolvedValueOnce({
      id: 'sub_generated',
      externalReference: 'subscription:sub_generated',
      asaasSubscriptionId: 'asaas_sub_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({
      id: 'sub_generated',
      externalReference: 'alusa:subscription:m1:c1',
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
          status: 'REQUESTED',
        }),
      }),
    );
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ asaasSubscriptionId: 'asaas_sub_1' }) }),
    );

    expect(prisma.matricula.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { asaasSubscriptionId: 'asaas_sub_1' },
    });
    expect(materializeBillingAgreement).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: expect.any(String), contaId: 't1' }),
      expect.objectContaining({ tx: expect.any(Object) }),
    );
  });

  it('deve enviar billingType CREDIT_CARD ao Asaas quando wizard solicitar CREDIT_CARD', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createSubscription: asaasCreateSubscription } = await import('@alusa/asaas');
    const { getSubscription } = await import('../asaas-ops');
    const { ensureCustomer } = await import('../ensure-customer');

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
    vi.mocked(getSubscription).mockResolvedValueOnce({
      id: 'asaas_sub_1', status: 'ACTIVE', deleted: false, externalReference: 'alusa:subscription:m1:c1',
    } as never);

    vi.mocked(prisma.subscription.create).mockResolvedValueOnce({
      id: 'sub_generated',
      externalReference: 'subscription:sub_generated',
      asaasSubscriptionId: 'asaas_sub_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValueOnce({
      id: 'sub_generated', externalReference: 'alusa:subscription:m1:c1', asaasSubscriptionId: 'asaas_sub_1', status: 'ACTIVE', createdAt: new Date('2099-01-01T00:00:00.000Z'), statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
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
