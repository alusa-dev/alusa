import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCharge } from '../create-charge';
import { deriveDeterministicId } from '../../core';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      asaasAccount: {
        findUnique: vi.fn(),
      },
      asaasIntegrationJob: {
        findFirst: vi.fn(async () => null),
      },
      cobranca: {
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      charge: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(async (args) => ({ id: args.data.id })),
        upsert: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    },
  };
});

vi.mock('../../foundation/finance-profile.service', () => ({
  financeProfileService: {
    getOrCreateByTenant: vi.fn(),
  },
}));

vi.mock('../ensure-customer', () => ({
  ensureCustomer: vi.fn(async () => ({ success: true, data: { customerId: 'cust_1', localCustomerId: 'local_cust_1', externalReference: 'customer:r1' } })),
}));

vi.mock('../create-payment', () => ({
  createAsaasPayment: vi.fn(async () => ({ success: true, data: { id: 'pay_1', externalReference: 'charge:c1' } })),
}));

vi.mock('../asaas-ops', () => ({
  getPayment: vi.fn(async () => ({ id: 'pay_1', externalReference: 'charge:c1', status: 'PENDING' })),
  listPayments: vi.fn(async (filters: { offset?: number; limit?: number } = {}) => ({ data: [], hasMore: false, totalCount: 0, offset: filters.offset ?? 0, limit: filters.limit ?? 100 })),
}));

vi.mock('../outbound-financial-operation', () => ({
  parseOutboundFinancialOperation: vi.fn((payload) => payload),
  reserveOutboundFinancialOperation: vi.fn(async () => ({
    job: { id: 'job-1' }, payload: { remoteId: null, state: 'INTENT_CREATED' },
  })),
  markOutboundRemoteRequested: vi.fn(async () => true),
  markOutboundRemoteConfirmed: vi.fn(),
  markOutboundAwaitingWebhook: vi.fn(),
  markOutboundResultUnknown: vi.fn(),
  markOutboundRequiresReconciliation: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

vi.mock('../../foundation/kyc-guard', () => ({
  requireKycApproved: vi.fn(async () => ({ success: true, data: true })),
}));

async function preparePendingCharge() {
  const { prisma } = await import('@alusa/database');
  vi.mocked(prisma.cobranca.findFirst).mockResolvedValue({
    id: 'c1', asaasPaymentId: null, asaasId: null, valor: 10,
    vencimento: new Date('2099-01-02T00:00:00.000Z'), descricao: 'Teste', formaPagamento: 'PIX',
    matricula: {
      id: 'm1', responsavelFinanceiroId: 'r1',
      aluno: { id: 'a1', cpf: '83750216010', dataNasc: new Date('2000-01-01T00:00:00.000Z') },
      responsavelFinanceiro: { id: 'r1', cpf: '83750216010' },
    },
  } as never);
  vi.mocked(prisma.charge.findUnique).mockResolvedValue(null as never);
  return prisma;
}

describe('createCharge', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Keep per-test claim races isolated; clearAllMocks preserves mock implementations.
    const { markOutboundRemoteRequested } = await import('../outbound-financial-operation');
    vi.mocked(markOutboundRemoteRequested).mockResolvedValue(true);
    const { listPayments } = await import('../asaas-ops');
    vi.mocked(listPayments).mockImplementation(async (filters = {}) => ({
      data: [], hasMore: false, totalCount: 0,
      offset: filters.offset ?? 0, limit: filters.limit ?? 100,
    }) as never);
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasIntegrationJob.findFirst).mockResolvedValue(null as never);
  });

  it('deve bloquear quando KYC não está aprovado', async () => {
    const { requireKycApproved } = await import('../../foundation/kyc-guard');
    const { ensureCustomer } = await import('../ensure-customer');
    const { createAsaasPayment } = await import('../create-payment');

    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: false, error: 'KYC_NAO_APROVADO' });

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER', id: 'u1' } });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('KYC_NAO_APROVADO');

    expect(ensureCustomer).not.toHaveBeenCalled();
    expect(createAsaasPayment).not.toHaveBeenCalled();
  });

  it('deve ser idempotente quando asaasPaymentId já existe', async () => {
    const { prisma } = await import('@alusa/database');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');

    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'APPROVED' } as never);
    vi.mocked(prisma.charge.findUnique).mockResolvedValueOnce(null as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c1',
      asaasPaymentId: 'pay_existing',
      asaasId: null,
      valor: 10,
      vencimento: new Date('2099-01-01T00:00:00.000Z'),
      descricao: null,
      formaPagamento: 'BOLETO',
      matricula: {
        id: 'm1',
        responsavelFinanceiroId: 'r1',
        aluno: { id: 'a1', cpf: '83750216010', dataNasc: new Date('2000-01-01T00:00:00.000Z') },
        responsavelFinanceiro: { id: 'r1', cpf: '83750216010' },
      },
    } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER', id: 'u1' } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.asaasPaymentId).toBe('pay_existing');
      expect(result.data.externalReference).toBe('charge:c1');
      expect(result.data.chargeId).toBe('c1');
    }

    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
  });

  it('deve criar payment oficial e aguardar materialização via webhook', async () => {
    const { prisma } = await import('@alusa/database');
    const { createAsaasPayment } = await import('../create-payment');
    const { listPayments } = await import('../asaas-ops');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({ status: 'APPROVED' } as never);
    vi.mocked(prisma.charge.findUnique).mockResolvedValueOnce(null as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c1',
      asaasPaymentId: null,
      asaasId: null,
      valor: 10,
      vencimento: new Date('2099-01-01T00:00:00.000Z'),
      descricao: 'Teste',
      formaPagamento: 'PIX',
      matricula: {
        id: 'm1',
        responsavelFinanceiroId: 'r1',
        aluno: { id: 'a1', cpf: '83750216010', dataNasc: new Date('2000-01-01T00:00:00.000Z') },
        responsavelFinanceiro: { id: 'r1', cpf: '83750216010' },
      },
    } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER', id: 'u1' } });

    expect(result.success).toBe(true);
    expect(createAsaasPayment).toHaveBeenCalled();
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.charge.payment_requested',
        entity: { type: 'Cobranca', id: 'c1' },
        metadata: expect.objectContaining({
          asaasPaymentId: 'pay_1',
          awaitingOfficialMaterialization: true,
        }),
      }),
    );
  });

  it('converge chamadas simultâneas na mesma cobrança em um payment e uma associação local', async () => {
    const prisma = await preparePendingCharge();
    const { createAsaasPayment } = await import('../create-payment');
    const { listPayments } = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValue({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValue({ status: 'APPROVED' } as never);

    const durableCharge = { id: deriveDeterministicId('ch', 't1:c1') };
    let createAttempts = 0;
    let durableAssociations = 0;
    let remotePaymentVisible = false;
    vi.mocked(createAsaasPayment).mockImplementation(async () => {
      remotePaymentVisible = true;
      return { success: true, data: { id: 'pay_1', externalReference: 'charge:c1' } } as never;
    });
    vi.mocked(listPayments).mockImplementation(async (filters = {}) => ({
      data: remotePaymentVisible
        ? [{ id: 'pay_1', externalReference: 'charge:c1' }]
        : [],
      hasMore: false,
      totalCount: remotePaymentVisible ? 1 : 0,
      offset: filters.offset ?? 0,
      limit: filters.limit ?? 100,
    }) as never);
    vi.mocked(prisma.asaasIntegrationJob.findFirst).mockImplementation(async () =>
      remotePaymentVisible
        ? ({
            payload: {
              version: 1,
              state: 'REMOTE_CONFIRMED',
              resource: 'PAYMENT',
              entityId: 'c1',
              externalReference: 'charge:c1',
              correlationId: 'charge:c1',
              requestFingerprint: 'fingerprint',
              remoteId: 'pay_1',
            },
          } as never)
        : null,
    );
    vi.mocked(prisma.charge.create).mockImplementation(async (args) => {
      createAttempts += 1;
      if (createAttempts === 1) {
        durableAssociations += 1;
        return durableCharge as never;
      }
      // Model the unique association rejecting the concurrent insert.
      throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
    });
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(durableCharge as never);
    let claimed = false;
    vi.mocked(outbound.markOutboundRemoteRequested).mockImplementation(async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    });

    const input = { contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER' as const, id: 'u1' } };
    const results = await Promise.all([createCharge(input), createCharge(input)]);

    expect(durableAssociations).toBe(1);
    expect(prisma.charge.create).toHaveBeenCalledTimes(2);
    expect(createAsaasPayment).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      success: true,
      data: { chargeId: durableCharge.id, asaasPaymentId: 'pay_1', externalReference: 'charge:c1' },
    });
    expect(prisma.charge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: durableCharge.id, contaId: 't1' },
      data: expect.objectContaining({ asaasPaymentId: 'pay_1' }),
    }));
  });

  it('bounded concurrent loser returns retryable error then retry converges to winner payment', async () => {
    vi.useFakeTimers();
    try {
      const prisma = await preparePendingCharge();
      const { createAsaasPayment } = await import('../create-payment');
      const { listPayments } = await import('../asaas-ops');
      const outbound = await import('../outbound-financial-operation');
      const { financeProfileService } = await import('../../foundation/finance-profile.service');
      vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValue({ id: 'fp1' } as never);
      vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValue({ status: 'APPROVED' } as never);

      const durableCharge = { id: deriveDeterministicId('ch', 't1:c1') };
      let chargeCreateAttempts = 0;
      vi.mocked(prisma.charge.create).mockImplementation(async () => {
        chargeCreateAttempts += 1;
        if (chargeCreateAttempts > 1) throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
        return durableCharge as never;
      });
      vi.mocked(prisma.charge.findFirst).mockResolvedValue(durableCharge as never);

      let releasePost!: (value: { success: true; data: { id: string; externalReference: string } }) => void;
      let signalPostStarted!: () => void;
      const postStarted = new Promise<void>((resolve) => { signalPostStarted = resolve; });
      const pendingPost = new Promise<{ success: true; data: { id: string; externalReference: string } }>((resolve) => { releasePost = resolve; });
      vi.mocked(createAsaasPayment).mockImplementation(async () => {
        signalPostStarted();
        return pendingPost as never;
      });

      let ownerClaimed = false;
      vi.mocked(outbound.markOutboundRemoteRequested).mockImplementation(async () => {
        if (ownerClaimed) return false;
        ownerClaimed = true;
        return true;
      });
      let reserveCalls = 0;
      vi.mocked(outbound.reserveOutboundFinancialOperation).mockImplementation(async () => {
        reserveCalls += 1;
        if (reserveCalls === 1) return { job: { id: 'job-1' }, payload: { remoteId: null, state: 'INTENT_CREATED' } } as never;
        if (reserveCalls === 2) return { job: { id: 'job-1' }, payload: { remoteId: null, state: 'REMOTE_REQUESTED' } } as never;
        return { job: { id: 'job-1' }, payload: { remoteId: 'pay_1', state: 'REMOTE_CONFIRMED' } } as never;
      });
      vi.mocked(listPayments).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);

      const input = { contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER' as const, id: 'u1' } };
      const winnerPromise = createCharge(input);
      await postStarted;
      const loserPromise = createCharge(input);

      await vi.advanceTimersByTimeAsync(500);
      const loserResult = await loserPromise;
      expect(loserResult).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
      expect(createAsaasPayment).toHaveBeenCalledTimes(1);

      releasePost({ success: true, data: { id: 'pay_1', externalReference: 'charge:c1' } });
      const winnerResult = await winnerPromise;
      expect(winnerResult).toMatchObject({
        success: true,
        data: { chargeId: durableCharge.id, asaasPaymentId: 'pay_1', externalReference: 'charge:c1' },
      });

      const retryResult = await createCharge(input);
      expect(retryResult).toEqual(winnerResult);
      expect(createAsaasPayment).toHaveBeenCalledTimes(1);
      expect(outbound.reserveOutboundFinancialOperation).toHaveBeenCalledTimes(3);
    } finally {
      const { createAsaasPayment } = await import('../create-payment');
      const outbound = await import('../outbound-financial-operation');
      const { prisma } = await import('@alusa/database');
      vi.mocked(createAsaasPayment).mockReset().mockResolvedValue({
        success: true, data: { id: 'pay_1', externalReference: 'charge:c1' },
      } as never);
      vi.mocked(outbound.reserveOutboundFinancialOperation).mockReset().mockResolvedValue({
        job: { id: 'job-1' }, payload: { remoteId: null, state: 'INTENT_CREATED' },
      } as never);
      vi.mocked(outbound.markOutboundRemoteRequested).mockReset().mockResolvedValue(true);
      vi.mocked(prisma.charge.create).mockReset().mockImplementation(async (args) => ({ id: args.data.id }) as never);
      vi.mocked(prisma.charge.findFirst).mockReset();
      vi.useRealTimers();
    }
  });

  it('aguarda confirmação durável quando a reserva já está REMOTE_REQUESTED', async () => {
    const prisma = await preparePendingCharge();
    const { createAsaasPayment } = await import('../create-payment');
    const outbound = await import('../outbound-financial-operation');
    const { financeProfileService } = await import('../../foundation/finance-profile.service');
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValue({ id: 'fp1' } as never);
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValue({ status: 'APPROVED' } as never);
    vi.mocked(outbound.reserveOutboundFinancialOperation).mockResolvedValueOnce({
      job: { id: 'job-1' },
      payload: { remoteId: null, state: 'REMOTE_REQUESTED' },
    } as never);
    vi.mocked(prisma.asaasIntegrationJob.findFirst).mockResolvedValueOnce({
      payload: {
        version: 1,
        state: 'REMOTE_CONFIRMED',
        resource: 'PAYMENT',
        entityId: 'c1',
        externalReference: 'charge:c1',
        correlationId: 'charge:c1',
        requestFingerprint: 'fingerprint',
        remoteId: 'pay_1',
      },
    } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER' } });

    expect(result).toMatchObject({
      success: true,
      data: { asaasPaymentId: 'pay_1', externalReference: 'charge:c1' },
    });
    expect(createAsaasPayment).not.toHaveBeenCalled();
    expect(outbound.markOutboundRemoteRequested).not.toHaveBeenCalled();
    expect(prisma.asaasIntegrationJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-1', contaId: 't1' },
      select: { payload: true },
    });
  });

  it('preserva REMOTE_CONFIRMED quando a confirmação remota fica temporariamente indisponível', async () => {
    await preparePendingCharge();
    const { createAsaasPayment } = await import('../create-payment');
    const { getPayment } = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    vi.mocked(outbound.reserveOutboundFinancialOperation).mockResolvedValueOnce({
      job: { id: 'job-1' },
      payload: { remoteId: 'pay_1', state: 'REMOTE_CONFIRMED' },
    } as never);
    vi.mocked(getPayment).mockRejectedValue(new Error('temporary provider failure'));

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER' } });

    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
    expect(createAsaasPayment).not.toHaveBeenCalled();
    expect(outbound.markOutboundRemoteRequested).not.toHaveBeenCalled();
    expect(outbound.markOutboundResultUnknown).not.toHaveBeenCalled();
  });

  it('bloqueia POST se o preflight completo por externalReference falhar', async () => {
    await preparePendingCharge();
    const { createAsaasPayment } = await import('../create-payment');
    const { listPayments } = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    vi.mocked(listPayments).mockRejectedValueOnce(new Error('provider lookup unavailable'));

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER' } });
    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
    expect(createAsaasPayment).not.toHaveBeenCalled();
    expect(outbound.markOutboundRemoteRequested).not.toHaveBeenCalled();
  });

  it('não repete POST de operação incerta mesmo quando a busca completa não encontra payment', async () => {
    await preparePendingCharge();
    const { createAsaasPayment } = await import('../create-payment');
    const { listPayments } = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    vi.mocked(outbound.reserveOutboundFinancialOperation).mockResolvedValueOnce({
      job: { id: 'job-1' },
      payload: { remoteId: null, state: 'RESULT_UNKNOWN' },
    } as never);
    vi.mocked(listPayments).mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER' } });
    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
    expect(createAsaasPayment).not.toHaveBeenCalled();
    expect(outbound.markOutboundRemoteRequested).not.toHaveBeenCalled();
    expect(outbound.markOutboundResultUnknown).toHaveBeenCalled();
  });

  it('não adota match parcial quando hasMore persiste até o limite de páginas', async () => {
    await preparePendingCharge();
    const { createAsaasPayment } = await import('../create-payment');
    const { listPayments } = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    for (let page = 0; page < 100; page += 1) {
      vi.mocked(listPayments).mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, index) => ({
          id: page === 0 && index === 0 ? 'pay_match' : `deleted-${page}-${index}`,
          externalReference: 'charge:c1',
          deleted: true,
        })),
        hasMore: true,
        totalCount: 10001,
        offset: page * 100,
        limit: 100,
      } as never);
    }
    const { getPayment } = await import('../asaas-ops');
    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_match', externalReference: 'charge:c1', customer: 'cust_1',
      value: 10, dueDate: '2099-01-01', status: 'PENDING',
    } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER' } });
    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
    expect(listPayments).toHaveBeenCalledTimes(100);
    expect(listPayments.mock.calls.map(([filters]) => filters.offset)).toEqual(
      Array.from({ length: 100 }, (_, page) => page * 100),
    );
    expect(createAsaasPayment).not.toHaveBeenCalled();
    expect(outbound.markOutboundRequiresReconciliation).toHaveBeenCalledWith(expect.objectContaining({ error: 'MULTIPLE_REMOTE_PAYMENTS_FOR_EXTERNAL_REFERENCE' }));
    expect(outbound.markOutboundRemoteConfirmed).not.toHaveBeenCalled();
  });

  it('não permite que conta B acesse ou altere cobrança e payment de conta A', async () => {
    const prisma = await preparePendingCharge();
    const { createAsaasPayment } = await import('../create-payment');
    const { listPayments, getPayment } = await import('../asaas-ops');
    const outbound = await import('../outbound-financial-operation');
    vi.mocked(prisma.cobranca.findFirst).mockImplementationOnce(async (args) => {
      expect(args.where).toEqual({
        id: 'c1',
        matricula: { aluno: { contaId: 'tenant-b' } },
      });
      return null;
    });

    const result = await createCharge({
      contaId: 'tenant-b', cobrancaId: 'c1', actor: { type: 'USER' },
    });
    expect(result).toMatchObject({ success: false, error: 'COBRANCA_NAO_ENCONTRADA' });
    expect(createAsaasPayment).not.toHaveBeenCalled();
    expect(listPayments).not.toHaveBeenCalled();
    expect(getPayment).not.toHaveBeenCalled();
    expect(prisma.charge.create).not.toHaveBeenCalled();
    expect(prisma.charge.updateMany).not.toHaveBeenCalled();
    expect(prisma.cobranca.updateMany).not.toHaveBeenCalled();
    expect(outbound.reserveOutboundFinancialOperation).not.toHaveBeenCalled();
  });

  it('pagina recuperação após POST e confirma a referência por getPayment', async () => {
    await preparePendingCharge();
    const { createAsaasPayment } = await import('../create-payment');
    const { getPayment, listPayments } = await import('../asaas-ops');
    vi.mocked(createAsaasPayment).mockResolvedValueOnce({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' } as never);
    vi.mocked(listPayments)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never) // preflight ausente
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, index) => ({ id: `recovery-${index}`, externalReference: 'charge:c1', deleted: true })), hasMore: true, totalCount: 101, offset: 0, limit: 100,
      } as never)
      .mockResolvedValueOnce({ data: [{ id: 'pay_recovered', externalReference: 'charge:c1' }], hasMore: false, totalCount: 101, offset: 100, limit: 100 } as never);
    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_recovered', externalReference: 'charge:c1', customer: 'cust_1',
      value: 10, dueDate: '2099-01-01', status: 'PENDING',
    } as never);

    const result = await createCharge({ contaId: 't1', cobrancaId: 'c1', actor: { type: 'USER' } });
    expect(result).toMatchObject({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
    expect(createAsaasPayment).toHaveBeenCalledTimes(1);
    expect(listPayments.mock.calls.map(([filters]) => filters.offset)).toEqual([0, 0, 100]);
    expect(listPayments.mock.calls.every(([filters, options]) =>
      filters.externalReference === 'charge:c1' && options.contaId === 't1',
    )).toBe(true);
    expect(getPayment).not.toHaveBeenCalled();
  });
});
