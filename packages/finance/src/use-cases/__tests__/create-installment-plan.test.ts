import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createInstallmentPlan } from '../create-installment-plan';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      matricula: {
        findFirst: vi.fn(),
      },
      contrato: {
        findFirst: vi.fn(),
      },
      installmentPlan: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  createInstallment: vi.fn(),
  listInstallmentPayments: vi.fn(),
}));

vi.mock('../asaas-ops', () => ({
  listPayments: vi.fn(async (filters: { offset?: number; limit?: number } = {}) => ({ data: [], hasMore: false, totalCount: 0, offset: filters.offset ?? 0, limit: filters.limit ?? 100 })),
  getInstallment: vi.fn(async () => null),
}));

vi.mock('../outbound-financial-operation', () => ({
  reserveOutboundFinancialOperation: vi.fn(async (input) => ({
    job: { id: 'job1' },
    payload: {
      version: 1,
      state: 'INTENT_CREATED',
      resource: input.resource,
      entityId: input.entityId,
      externalReference: input.externalReference,
      correlationId: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
    },
  })),
  markOutboundRemoteRequested: vi.fn(async () => true),
  markOutboundRemoteConfirmed: vi.fn(async () => {}),
  markOutboundAwaitingWebhook: vi.fn(async () => {}),
  markOutboundResultUnknown: vi.fn(async () => {}),
  markOutboundRequiresReconciliation: vi.fn(async () => {}),
  markOutboundFailed: vi.fn(async () => {}),
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

async function prepareCreateMocks() {
  const { prisma, loadAsaasCredentials } = await import('@alusa/database');
  const { createInstallment } = await import('@alusa/asaas');
  const { featureFlagsService } = await import('../../foundation/feature-flags.service');
  const { ensureCustomer } = await import('../ensure-customer');
  vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
  vi.mocked(prisma.matricula.findFirst).mockResolvedValue({
    id: 'm1', alunoId: 'a1', responsavelFinanceiroId: 'r1',
    aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
  } as never);
  vi.mocked(prisma.contrato.findFirst).mockResolvedValue({ id: 'c1' } as never);
  vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue(null as never);
  vi.mocked(ensureCustomer).mockResolvedValue({ success: true, data: { customerId: 'cus1' } } as never);
  vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key', contaId: 't1' } as never);
  return { prisma, createInstallment };
}

describe('createInstallmentPlan', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const outbound = await import('../outbound-financial-operation');
    vi.mocked(outbound.reserveOutboundFinancialOperation).mockImplementation(async (input) => ({
      job: { id: 'job1' } as never,
      payload: {
        version: 1,
        state: 'INTENT_CREATED',
        resource: input.resource,
        entityId: input.entityId,
        externalReference: input.externalReference,
        correlationId: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
      },
    } as never));
    vi.mocked(outbound.markOutboundRemoteRequested).mockResolvedValue(true);
    const ops = await import('../asaas-ops');
    vi.mocked(ops.listPayments).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);
    vi.mocked(ops.getInstallment).mockResolvedValue(null as never);
    const asaas = await import('@alusa/asaas');
    vi.mocked(asaas.listInstallmentPayments).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);

    const { requireKycApproved } = await import('../../foundation/kyc-guard');
    vi.mocked(requireKycApproved).mockResolvedValue({ success: true, data: true } as never);
  });

  it('deve bloquear quando enableInstallments está off', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(false);

    const res = await createInstallmentPlan({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: 150,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('FEATURE_DISABLED');
  });

  it('deve retornar idempotente quando já existe InstallmentPlan com asaasInstallmentId', async () => {
    const { prisma } = await import('@alusa/database');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);

    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1',
      alunoId: 'a1',
      responsavelFinanceiroId: 'r1',
    } as never);

    vi.mocked(prisma.contrato.findFirst).mockResolvedValueOnce({ id: 'c1' } as never);

    vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValueOnce({
      id: 'ip1',
      contratoId: 'c1',
      matriculaId: 'm1',
      externalReference: 'installmentPlan:ip1',
      asaasInstallmentId: 'asaas_inst_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    const res = await createInstallmentPlan({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: 150,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toMatchObject({
        installmentPlanId: 'ip1',
        externalReference: 'installmentPlan:ip1',
        asaasInstallmentId: 'asaas_inst_1',
        status: 'ACTIVE',
      });
    }
  });

  it('envia parcelamento remoto divergente para reconciliação crítica', async () => {
    const { createInstallment } = await prepareCreateMocks();
    const outbound = await import('../outbound-financial-operation');
    vi.mocked(createInstallment).mockResolvedValueOnce({
      id: 'asaas_inst_mismatch', installmentCount: 3, value: 151, customer: 'cus1',
    } as never);

    const result = await createInstallmentPlan({
      contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO', value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' },
    });

    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PARCELAMENTO' });
    expect(outbound.markOutboundRequiresReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      resource: 'INSTALLMENT_PLAN', error: 'REMOTE_INSTALLMENT_CONFIRMATION_MISMATCH',
    }));
    expect(outbound.markOutboundResultUnknown).not.toHaveBeenCalled();
  });

  it('deve criar parcelamento no Asaas e persistir asaasInstallmentId', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createInstallment: asaasCreateInstallment, listInstallmentPayments } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');
    const ops = await import('../asaas-ops');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);

    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1',
      alunoId: 'a1',
      responsavelFinanceiroId: 'r1',
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);

    vi.mocked(prisma.contrato.findFirst).mockResolvedValueOnce({ id: 'c1' } as never);

    // Nenhum plano existente
    vi.mocked(prisma.installmentPlan.findUnique)
      .mockResolvedValueOnce(null as never) // byContrato
      .mockResolvedValueOnce(null as never); // byMatricula

    vi.mocked(ensureCustomer).mockResolvedValueOnce({
      success: true,
      data: { customerId: 'asaas_cus_1', externalReference: 'financeProfile:fp1' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x', contaId: 't1' } as never);
    vi.mocked(ops.listPayments).mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);

    vi.mocked(asaasCreateInstallment).mockResolvedValueOnce({
      object: 'installment',
      id: 'asaas_inst_1',
      installmentCount: 3,
      billingType: 'BOLETO',
      deleted: false,
    } as never);

    // Sem pagamentos gerados (simplifica teste)
    vi.mocked(listInstallmentPayments).mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);

    vi.mocked(prisma.installmentPlan.create).mockResolvedValueOnce({
      id: 'ip1',
      externalReference: 'alusa:installment:ip1',
      asaasInstallmentId: 'asaas_inst_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    const res = await createInstallmentPlan({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: 150,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);

    expect(asaasCreateInstallment).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sandbox_x',
        data: expect.objectContaining({
          customer: 'asaas_cus_1',
          installmentCount: 3,
          value: 150,
          dueDate: '2099-01-10',
          billingType: 'BOLETO',
        }),
      }),
    );

    // paymentExternalReference deve estar no formato V2 (sem subcontaId)
    const callData = vi.mocked(asaasCreateInstallment).mock.calls[0][0].data;
    expect(callData.paymentExternalReference).toMatch(/^alusa:installment:/);
    expect(callData.paymentExternalReference!.length).toBeLessThanOrEqual(100);
  });

  it('serializa duas chamadas concorrentes em uma única operação remota e local', async () => {
    const { prisma } = await import('@alusa/database');
    const { createInstallment } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');
    const outbound = await import('../outbound-financial-operation');
    const ops = await import('../asaas-ops');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValue({
      id: 'm1', alunoId: 'a1', responsavelFinanceiroId: 'r1',
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);
    vi.mocked(prisma.contrato.findFirst).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue(null as never);
    vi.mocked(ensureCustomer).mockResolvedValue({ success: true, data: { customerId: 'cus1' } } as never);
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key', contaId: 't1' } as never);
    vi.mocked(ops.listPayments).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);
    vi.mocked(createInstallment).mockResolvedValue({ id: 'inst1', installmentCount: 3, value: 150 } as never);
    vi.mocked(prisma.installmentPlan.create).mockResolvedValue({
      id: 'ip1', externalReference: 'alusa:installment:ip1', asaasInstallmentId: 'inst1', status: 'ACTIVE',
      createdAt: new Date('2099-01-01'), statusUpdatedAt: new Date('2099-01-01'),
    } as never);
    let claimed = false;
    let claimCalls = 0;
    let releaseBarrier!: () => void;
    const bothAtClaim = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    vi.mocked(outbound.markOutboundRemoteRequested).mockImplementation(async () => {
      const ownsClaim = !claimed;
      claimed = true;
      claimCalls += 1;
      if (claimCalls === 2) releaseBarrier();
      await bothAtClaim;
      return ownsClaim;
    });

    const input = {
      contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO' as const, value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' as const },
    };
    const results = await Promise.all([createInstallmentPlan(input), createInstallmentPlan(input)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(createInstallment).toHaveBeenCalledTimes(1);
    expect(prisma.installmentPlan.create).toHaveBeenCalledTimes(1);
    const reservations = vi.mocked(outbound.reserveOutboundFinancialOperation).mock.calls;
    expect(reservations).toHaveLength(2);
    expect(reservations[0]?.[0]).toMatchObject({ contaId: 't1', type: 'CREATE_INSTALLMENT' });
    expect(reservations[1]?.[0]).toMatchObject({ contaId: 't1', type: 'CREATE_INSTALLMENT' });
    expect(reservations[1]?.[0].idempotencyKey).toBe(reservations[0]?.[0].idempotencyKey);
    expect(reservations[1]?.[0].requestFingerprint).toBe(reservations[0]?.[0].requestFingerprint);
  });

  it('bloqueia POST de plano local legado sem ID quando o preflight remoto falha', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createInstallment } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');
    const ops = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValue({
      id: 'm1', alunoId: 'a1', responsavelFinanceiroId: 'r1',
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);
    vi.mocked(prisma.contrato.findFirst).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.installmentPlan.findUnique)
      .mockResolvedValueOnce({
        id: 'ip_legacy', contratoId: 'c1', matriculaId: 'm1',
        externalReference: 'alusa:installment:ip_legacy', asaasInstallmentId: null,
        status: 'ACTIVE', createdAt: new Date('2099-01-01'), statusUpdatedAt: new Date('2099-01-01'),
      } as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(ensureCustomer).mockResolvedValue({ success: true, data: { customerId: 'cus1' } } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key', contaId: 't1' } as never);
    vi.mocked(ops.listPayments).mockRejectedValueOnce(new Error('lookup unavailable'));

    const result = await createInstallmentPlan({
      contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO', value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' },
    });
    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PARCELAMENTO' });
    expect(createInstallment).not.toHaveBeenCalled();
    expect(outbound.markOutboundRemoteRequested).not.toHaveBeenCalled();
  });

  it('não conclui ausência quando GET do installment encontrado falha', async () => {
    const { prisma, createInstallment } = await prepareCreateMocks();
    const ops = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    vi.mocked(ops.listPayments).mockResolvedValue({
      data: [{ id: 'payment1', installment: 'installment1' }], hasMore: false, totalCount: 1, offset: 0, limit: 100,
    } as never);
    vi.mocked(ops.getInstallment).mockRejectedValue(new Error('installment read unavailable'));

    const result = await createInstallmentPlan({
      contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO', value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' },
    });
    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PARCELAMENTO' });
    expect(createInstallment).not.toHaveBeenCalled();
    expect(outbound.markOutboundRemoteRequested).not.toHaveBeenCalled();
    expect(prisma.installmentPlan.create).not.toHaveBeenCalled();
  });

  it('manda payments mistos com/sem installment ID para reconciliação, nunca trata como ausência', async () => {
    const { prisma, createInstallment } = await prepareCreateMocks();
    const ops = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    vi.mocked(ops.listPayments).mockResolvedValue({
      data: [
        { id: 'payment_with_installment', installment: 'installment1' },
        { id: 'payment_without_installment', installment: null },
      ],
      hasMore: false, totalCount: 2, offset: 0, limit: 100,
    } as never);

    const result = await createInstallmentPlan({
      contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO', value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' },
    });
    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PARCELAMENTO' });
    expect(outbound.markOutboundRequiresReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      error: 'REMOTE_PAYMENTS_WITHOUT_INSTALLMENT_REFERENCE',
    }));
    expect(createInstallment).not.toHaveBeenCalled();
    expect(prisma.installmentPlan.create).not.toHaveBeenCalled();
  });

  it('marca timeout como incerto e recupera o parcelamento por referência no retry, sem novo POST', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createInstallment } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');
    const outbound = await import('../outbound-financial-operation');
    const ops = await import('../asaas-ops');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValue({
      id: 'm1', alunoId: 'a1', responsavelFinanceiroId: 'r1',
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);
    vi.mocked(prisma.contrato.findFirst).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue(null as never);
    vi.mocked(ensureCustomer).mockResolvedValue({ success: true, data: { customerId: 'cus1' } } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key', contaId: 't1' } as never);
    vi.mocked(createInstallment).mockReset();
    let remoteInstallment: { id: string; installmentCount: number; value: number } | null = null;
    vi.mocked(createInstallment).mockImplementationOnce(async () => {
      remoteInstallment = { id: 'inst_after_timeout', installmentCount: 3, value: 150 };
      throw new Error('timeout after provider accepted request');
    });
    vi.mocked(ops.listPayments)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never) // before POST
      .mockRejectedValueOnce(new Error('temporary read failure')) // timeout recovery is inconclusive
      .mockImplementationOnce(async () => ({
        data: Array.from({ length: 100 }, (_, index) => ({ id: index === 0 ? 'payment_page_one' : `filler-${index}`, installment: remoteInstallment?.id ?? 'inst_after_timeout' })),
        hasMore: true,
        totalCount: 101, offset: 0, limit: 100,
      }) as never) // retry, first page
      .mockImplementationOnce(async (filters) => ({
        data: remoteInstallment
          ? [{ id: 'payment1', installment: remoteInstallment.id }]
          : [],
        hasMore: false,
        totalCount: 101,
        offset: filters.offset,
        limit: filters.limit,
      }) as never);
    const first = await createInstallmentPlan({
      contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO', value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' },
    });
    expect(first).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PARCELAMENTO' });
    expect(outbound.markOutboundResultUnknown).toHaveBeenCalled();

    vi.mocked(outbound.reserveOutboundFinancialOperation).mockImplementation(async (input) => ({
      job: { id: 'job1' } as never,
      payload: {
        version: 1, state: 'RESULT_UNKNOWN', resource: input.resource, entityId: input.entityId,
        externalReference: input.externalReference, correlationId: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
      },
    } as never));
    vi.mocked(ops.getInstallment).mockImplementation(async (id) =>
      id === remoteInstallment?.id ? remoteInstallment : null as never,
    );
    vi.mocked(prisma.installmentPlan.create).mockResolvedValue({
      id: 'ip1', externalReference: 'alusa:installment:ip1', asaasInstallmentId: 'inst_after_timeout', status: 'ACTIVE',
      createdAt: new Date('2099-01-01'), statusUpdatedAt: new Date('2099-01-01'),
    } as never);
    vi.mocked((await import('@alusa/asaas')).listInstallmentPayments).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);

    const retry = await createInstallmentPlan({
      contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO', value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' },
    });
    expect(retry.success).toBe(true);
    expect(createInstallment).toHaveBeenCalledTimes(1);
    expect(prisma.installmentPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ asaasInstallmentId: 'inst_after_timeout' }),
    }));
    expect(ops.listPayments.mock.calls.map(([filters]) => filters.offset)).toEqual([0, 0, 0, 100]);
    const reservations = vi.mocked(outbound.reserveOutboundFinancialOperation).mock.calls;
    expect(reservations[1]?.[0].externalReference).toBe(reservations[0]?.[0].externalReference);
    expect(reservations[1]?.[0].idempotencyKey).toBe(reservations[0]?.[0].idempotencyKey);
  });

  it.each([
    { status: 422, expectedState: 'failed' },
    { status: 503, expectedState: 'unknown' },
    { status: 408, expectedState: 'unknown' },
    { status: 409, expectedState: 'unknown' },
    { status: 425, expectedState: 'unknown' },
    { status: 429, expectedState: 'unknown' },
  ])('classifica erro HTTP $status sem repetir POST', async ({ status, expectedState }) => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createInstallment } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');
    const outbound = await import('../outbound-financial-operation');
    const ops = await import('../asaas-ops');
    let reservationCount = 0;
    vi.mocked(outbound.reserveOutboundFinancialOperation).mockImplementation(async (input) => {
      const state = reservationCount++ === 0 ? 'INTENT_CREATED' : 'RESULT_UNKNOWN';
      return {
        job: { id: 'job1' } as never,
        payload: {
          version: 1,
          state,
          resource: input.resource,
          entityId: input.entityId,
          externalReference: input.externalReference,
          correlationId: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
        },
      } as never;
    });
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValue({
      id: 'm1', alunoId: 'a1', responsavelFinanceiroId: 'r1',
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);
    vi.mocked(prisma.contrato.findFirst).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue(null as never);
    vi.mocked(ensureCustomer).mockResolvedValue({ success: true, data: { customerId: 'cus1' } } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'key', contaId: 't1' } as never);
    vi.mocked(ops.listPayments).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);
    vi.mocked(createInstallment).mockRejectedValueOnce(Object.assign(new Error('provider error'), { status }));

    const result = await createInstallmentPlan({
      contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO', value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' },
    });
    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PARCELAMENTO' });
    expect(createInstallment).toHaveBeenCalledTimes(1);
    if (expectedState === 'failed') {
      expect(outbound.markOutboundFailed).toHaveBeenCalled();
      expect(outbound.markOutboundResultUnknown).not.toHaveBeenCalled();
    } else {
      expect(outbound.markOutboundResultUnknown).toHaveBeenCalled();
      expect(outbound.markOutboundFailed).not.toHaveBeenCalled();
      const retry = await createInstallmentPlan({
        contaId: 't1', contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
        billingType: 'BOLETO', value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' },
      });
      expect(retry).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PARCELAMENTO' });
      expect(createInstallment).toHaveBeenCalledTimes(1);
    }
  });

  it('isola duas contas no caso de uso: chaves, fingerprints, referências, credenciais e lookups', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createInstallment, listInstallmentPayments } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');
    const outbound = await import('../outbound-financial-operation');
    const ops = await import('../asaas-ops');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValue({
      id: 'm1', alunoId: 'a1', responsavelFinanceiroId: 'r1',
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);
    vi.mocked(prisma.contrato.findFirst).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValue(null as never);
    vi.mocked(ensureCustomer).mockImplementation(async ({ contaId }) => ({
      success: true,
      data: { customerId: `customer-${contaId}` },
    }) as never);
    vi.mocked(loadAsaasCredentials).mockImplementation(async (contaId) => ({
      apiKey: `key-${contaId}`, contaId,
    }) as never);
    vi.mocked(createInstallment).mockImplementation(async ({ apiKey }) => ({
      id: `installment-${apiKey}`, installmentCount: 3, value: 150,
    }) as never);
    vi.mocked(prisma.installmentPlan.create).mockImplementation(async ({ data }) => ({
      id: data.id,
      externalReference: data.externalReference,
      asaasInstallmentId: data.asaasInstallmentId,
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01'),
      statusUpdatedAt: new Date('2099-01-01'),
    }) as never);
    vi.mocked(ops.listPayments).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);
    vi.mocked(listInstallmentPayments).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);

    const base = {
      contratoId: 'c1', matriculaId: 'm1', installmentCount: 3,
      billingType: 'BOLETO' as const, value: 150, firstDueDate: '2099-01-10', actor: { type: 'USER' as const },
    };
    const first = await createInstallmentPlan({ ...base, contaId: 'tenant-a' });
    const second = await createInstallmentPlan({ ...base, contaId: 'tenant-b' });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const reservations = vi.mocked(outbound.reserveOutboundFinancialOperation).mock.calls.map(([input]) => input);
    expect(reservations).toHaveLength(2);
    expect(reservations.map((input) => input.contaId)).toEqual(['tenant-a', 'tenant-b']);
    expect(reservations[0]?.idempotencyKey).not.toBe(reservations[1]?.idempotencyKey);
    expect(reservations[0]?.requestFingerprint).not.toBe(reservations[1]?.requestFingerprint);
    expect(reservations[0]?.externalReference).not.toBe(reservations[1]?.externalReference);
    expect(vi.mocked(loadAsaasCredentials).mock.calls).toEqual([['tenant-a'], ['tenant-b']]);
    expect(vi.mocked(createInstallment).mock.calls.map(([input]) => input.apiKey)).toEqual([
      'key-tenant-a', 'key-tenant-b',
    ]);
    expect(vi.mocked(ops.listPayments).mock.calls.map(([, options]) => options.contaId)).toEqual([
      'tenant-a', 'tenant-b',
    ]);
  });

  it('deve bloquear quando KYC não está aprovado', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { prisma } = await import('@alusa/database');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);
    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: false, error: 'KYC_NAO_APROVADO' } as never);

    const res = await createInstallmentPlan({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: 150,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('KYC_NAO_APROVADO');
    expect(prisma.matricula.findFirst).not.toHaveBeenCalled();
  });
});
