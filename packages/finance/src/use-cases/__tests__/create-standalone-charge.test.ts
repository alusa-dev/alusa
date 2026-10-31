import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createStandaloneCharge } from '../create-standalone-charge';

// Mock database
vi.mock('@alusa/database', () => {
  const mockPrisma = {
    aluno: {
      findFirst: vi.fn(),
    },
    responsavel: {
      findFirst: vi.fn(),
    },
    matricula: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    cobranca: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    installmentPlan: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    // $transaction executa o callback passando o próprio prisma como tx
    $transaction: vi.fn(async (fn: (_tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
  };
  return { prisma: mockPrisma, loadAsaasCredentials: vi.fn() };
});

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');
  return {
    ...actual,
    createSubscription: vi.fn(),
    listSubscriptionPayments: vi.fn(),
  };
});

// Mock use-cases
vi.mock('../ensure-customer', () => ({
  ensureCustomer: vi.fn(),
}));

vi.mock('../create-payment', () => ({
  createAsaasPayment: vi.fn(),
}));

vi.mock('../sync-payment-state-from-asaas', () => ({
  syncPaymentStateFromAsaas: vi.fn(async () => ({ success: true })),
}));

vi.mock('../asaas-ops', () => ({
  listPayments: vi.fn(async (filters: { offset?: number; limit?: number } = {}) => ({ data: [], hasMore: false, totalCount: 0, offset: filters.offset ?? 0, limit: filters.limit ?? 100 })),
  listSubscriptions: vi.fn(async (filters: { offset?: number; limit?: number } = {}) => ({ data: [], hasMore: false, totalCount: 0, offset: filters.offset ?? 0, limit: filters.limit ?? 100 })),
  getPayment: vi.fn(async (id: string) => {
    const { createAsaasPayment } = await import('../create-payment');
    const call = vi.mocked(createAsaasPayment).mock.calls.at(-1)?.[0];
    return { id, externalReference: call?.externalReference, status: 'PENDING' };
  }),
  getSubscription: vi.fn(async (id: string) => {
    const { createSubscription } = await import('@alusa/asaas');
    const call = vi.mocked(createSubscription).mock.calls.at(-1)?.[0];
    return { id, externalReference: call?.data.externalReference, status: 'ACTIVE', deleted: false };
  }),
}));

vi.mock('../outbound-financial-operation', () => ({
  reserveOutboundFinancialOperation: vi.fn(async () => ({
    job: { id: 'job-1' }, payload: { remoteId: null, state: 'INTENT_CREATED' },
  })),
  markOutboundRemoteRequested: vi.fn(async () => true),
  markOutboundRemoteConfirmed: vi.fn(),
  markOutboundAwaitingWebhook: vi.fn(),
  markOutboundResultUnknown: vi.fn(),
  markOutboundRequiresReconciliation: vi.fn(),
}));

vi.mock('../../services/sync-customer-notifications-at-charge', () => ({
  syncCustomerNotificationsForUserSelection: vi.fn(),
  channelPreferencesFromWizardSelection: vi.fn((selected: string[]) => ({
    email: selected.includes('EMAIL'),
    sms: selected.includes('SMS'),
    whatsapp: selected.includes('WHATSAPP'),
  })),
}));

const {
  ensureCustomerNotificationsEnabledMock,
  enqueueAsaasNotificationSyncMock,
  recordNotificationSyncAuditMock,
} = vi.hoisted(() => ({
  ensureCustomerNotificationsEnabledMock: vi.fn(),
  enqueueAsaasNotificationSyncMock: vi.fn(),
  recordNotificationSyncAuditMock: vi.fn(),
}));

vi.mock('../../services/customer-notification.service', () => ({
  ensureCustomerNotificationsEnabled: ensureCustomerNotificationsEnabledMock,
}));

vi.mock('../../services/asaas-notification-sync-outbox.service', () => ({
  enqueueAsaasNotificationSync: enqueueAsaasNotificationSyncMock,
  recordNotificationSyncAudit: recordNotificationSyncAuditMock,
}));

// Mock foundation
vi.mock('../../foundation/kyc-guard', () => ({
  requireKycApproved: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(),
  },
}));

describe('createStandaloneCharge', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    const { prisma } = await import('@alusa/database');
    vi.clearAllMocks();
    const { createSubscription, listSubscriptionPayments } = await import('@alusa/asaas');
    const { createAsaasPayment } = await import('../create-payment');
    const { listPayments, listSubscriptions, getPayment, getSubscription } = await import('../asaas-ops');
    const {
      reserveOutboundFinancialOperation, markOutboundRemoteRequested, markOutboundRemoteConfirmed,
      markOutboundAwaitingWebhook, markOutboundResultUnknown, markOutboundRequiresReconciliation,
    } = await import('../outbound-financial-operation');
    vi.mocked(createSubscription).mockReset();
    vi.mocked(listSubscriptionPayments).mockReset();
    vi.mocked(createAsaasPayment).mockReset();
    vi.mocked(listPayments).mockReset().mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);
    vi.mocked(listSubscriptions).mockReset().mockResolvedValue({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);
    vi.mocked(getPayment).mockReset().mockImplementation(async (id) => {
      const call = vi.mocked(createAsaasPayment).mock.calls.at(-1)?.[0];
      return { id, externalReference: call?.externalReference, status: 'PENDING' } as never;
    });
    vi.mocked(getSubscription).mockReset().mockImplementation(async (id) => {
      const call = vi.mocked(createSubscription).mock.calls.at(-1)?.[0];
      return { id, externalReference: call?.data.externalReference, status: 'ACTIVE', deleted: false } as never;
    });
    vi.mocked(reserveOutboundFinancialOperation).mockReset().mockResolvedValue({
      job: { id: 'job-1' }, payload: { remoteId: null, state: 'INTENT_CREATED' },
    } as never);
    vi.mocked(markOutboundRemoteRequested).mockReset().mockResolvedValue(true);
    vi.mocked(markOutboundRemoteConfirmed).mockReset();
    vi.mocked(markOutboundAwaitingWebhook).mockReset();
    vi.mocked(markOutboundResultUnknown).mockReset();
    vi.mocked(markOutboundRequiresReconciliation).mockReset();
    vi.mocked(prisma.responsavel.findFirst).mockReset();
    ensureCustomerNotificationsEnabledMock.mockResolvedValue({ success: true });
    enqueueAsaasNotificationSyncMock.mockResolvedValue({ id: 'notification-outbox-1' });
  });

  describe('recuperação outbound', () => {
    it('envia pagamento standalone com confirmação remota divergente para reconciliação crítica', async () => {
      vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
      vi.stubEnv('PLAYWRIGHT_TEST', 'false');
      vi.stubEnv('NODE_ENV', 'development');
      const { prisma, loadAsaasCredentials } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { getPayment } = await import('../asaas-ops');
      const outbound = await import('../outbound-financial-operation');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({ id: 'mat-1', contratoAtualId: 'contract-1' } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({ nome: 'Responsável 1' } as never);
      vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key', contaId: 'conta-1' } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true, data: { customerId: 'cust-1', localCustomerId: 'local-cust-1', externalReference: 'payer-ref' },
      } as never);
      vi.mocked(createAsaasPayment).mockResolvedValueOnce({ success: true, data: { id: 'pay-1' } } as never);
      vi.mocked(getPayment).mockImplementationOnce(async (id) => {
        const paymentInput = vi.mocked(createAsaasPayment).mock.calls.at(-1)?.[0];
        return {
          id, externalReference: paymentInput?.externalReference,
          customer: 'wrong-customer', value: 100, dueDate: '2099-12-01',
        } as never;
      });

      const result = await createStandaloneCharge({
        contaId: 'conta-1', actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' }, chargeType: 'ONE_TIME',
        billingType: 'PIX', value: 100, dueDate: '2099-12-01',
      });

      expect(result).toEqual({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
      expect(outbound.markOutboundRequiresReconciliation).toHaveBeenCalledWith(expect.objectContaining({
        resource: 'PAYMENT', error: 'REMOTE_PAYMENT_CONFIRMATION_MISMATCH',
      }));
      expect(outbound.markOutboundResultUnknown).not.toHaveBeenCalled();
    });

    it('bloqueia POST quando preflight encontra match mas não consegue concluir paginação', async () => {
      vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
      vi.stubEnv('PLAYWRIGHT_TEST', 'false');
      vi.stubEnv('NODE_ENV', 'development');
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { listPayments, getPayment } = await import('../asaas-ops');
      const { reserveOutboundFinancialOperation } = await import('../outbound-financial-operation');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({ id: 'mat-1', contratoAtualId: 'contract-1' } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({ id: 'resp-1', nome: 'Responsável 1' } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust-1', localCustomerId: 'local-cust-1', externalReference: 'payer-ref' },
      } as never);
      vi.mocked(reserveOutboundFinancialOperation).mockResolvedValueOnce({
        job: { id: 'job-1' }, payload: { remoteId: null, state: 'INTENT_CREATED' },
      } as never);
      vi.mocked(listPayments).mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, index) => ({ id: `payment-${index}`, externalReference: 'alusa:standalone-charge:charge-1', deleted: true })),
        hasMore: true,
        totalCount: 101, offset: 0, limit: 100,
      } as never).mockRejectedValueOnce(new Error('timeout fetching next page'));

      const result = await createStandaloneCharge({
        contaId: 'conta-1', actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' }, chargeType: 'ONE_TIME',
        billingType: 'PIX', value: 100, dueDate: '2099-12-01',
      });

      expect(result).toEqual({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
      expect(listPayments).toHaveBeenCalledTimes(2);
      expect(vi.mocked(listPayments).mock.calls.map(([query]) => query.offset)).toEqual([0, 100]);
      expect(getPayment).not.toHaveBeenCalled();
      expect(createAsaasPayment).not.toHaveBeenCalled();
      expect(prisma.charge.create).toHaveBeenCalledTimes(1);
    });

    it('não repete POST para operação incerta quando a busca completa não encontra pagamento', async () => {
      vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
      vi.stubEnv('PLAYWRIGHT_TEST', 'false');
      vi.stubEnv('NODE_ENV', 'development');
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { listPayments, listSubscriptions } = await import('../asaas-ops');
      const { reserveOutboundFinancialOperation, markOutboundResultUnknown } = await import('../outbound-financial-operation');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({ id: 'mat-1', contratoAtualId: 'contract-1' } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({ id: 'resp-1', nome: 'Responsável 1' } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust-1', localCustomerId: 'local-cust-1', externalReference: 'payer-ref' },
      } as never);
      vi.mocked(reserveOutboundFinancialOperation).mockResolvedValueOnce({
        job: { id: 'job-1' }, payload: { remoteId: null, state: 'RESULT_UNKNOWN' },
      } as never);
      vi.mocked(listPayments).mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1', actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' }, chargeType: 'ONE_TIME',
        billingType: 'PIX', value: 100, dueDate: '2099-12-01',
      });

      expect(result).toEqual({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
      expect(listPayments).toHaveBeenCalledTimes(1);
      expect(createAsaasPayment).not.toHaveBeenCalled();
      expect(markOutboundResultUnknown).toHaveBeenCalledWith(expect.objectContaining({
        jobId: 'job-1', contaId: 'conta-1', resource: 'PAYMENT',
      }));
    });

    it('não confirma recuperação pós-POST se GET devolve ID diferente do candidato', async () => {
      vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
      vi.stubEnv('PLAYWRIGHT_TEST', 'false');
      vi.stubEnv('NODE_ENV', 'development');
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { listPayments, getPayment } = await import('../asaas-ops');
      const { markOutboundResultUnknown } = await import('../outbound-financial-operation');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({ id: 'mat-1', contratoAtualId: 'contract-1' } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({ id: 'resp-1', nome: 'Responsável 1' } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust-1', localCustomerId: 'local-cust-1', externalReference: 'payer-ref' },
      } as never);
      let paymentLookups = 0;
      vi.mocked(listPayments).mockImplementation(async (query) => {
        paymentLookups += 1;
        return paymentLookups === 1
          ? { data: [], hasMore: false, totalCount: 0, offset: query.offset, limit: query.limit } as never
          : { data: [{ id: 'payment-candidate', externalReference: query.externalReference }], hasMore: false, totalCount: 1, offset: query.offset, limit: query.limit } as never;
      });
      vi.mocked(createAsaasPayment).mockResolvedValueOnce({ success: false, error: 'fetch failed' } as never);
      vi.mocked(getPayment).mockResolvedValueOnce({
        id: 'payment-other', externalReference: 'alusa:standalone-charge:charge-1', status: 'PENDING',
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1', actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' }, chargeType: 'ONE_TIME',
        billingType: 'PIX', value: 100, dueDate: '2099-12-01',
      });

      expect(result).toEqual({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
      expect(createAsaasPayment).toHaveBeenCalledTimes(1);
      expect(getPayment).toHaveBeenCalledWith('payment-candidate', { contaId: 'conta-1' });
      expect(markOutboundResultUnknown).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'conta-1', error: 'fetch failed',
      }));
      expect(prisma.charge.updateMany).not.toHaveBeenCalled();
    });

    it('serializa duas chamadas iguais e mantém contaId nos lookups e GET', async () => {
      vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
      vi.stubEnv('PLAYWRIGHT_TEST', 'false');
      vi.stubEnv('NODE_ENV', 'development');
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { listPayments, getPayment } = await import('../asaas-ops');
      const { reserveOutboundFinancialOperation, markOutboundRemoteRequested } = await import('../outbound-financial-operation');
      let localCharge: { id: string } | null = null;
      let createAttempts = 0;
      vi.mocked(prisma.charge.findFirst).mockImplementation(async () => localCharge as never);
      vi.mocked(prisma.charge.create).mockImplementation(async () => {
        createAttempts += 1;
        if (localCharge) throw new Error('unique constraint');
        localCharge = { id: 'charge-1' };
        return localCharge as never;
      });
      vi.mocked(ensureCustomer).mockResolvedValue({
        success: true,
        data: { customerId: 'cust-1', localCustomerId: 'local-cust-1', externalReference: 'payer-ref' },
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValue({ id: 'resp-1', nome: 'Responsável 1' } as never);
      let releaseLookups!: () => void;
      const lookupGate = new Promise<void>((resolve) => { releaseLookups = resolve; });
      let lookups = 0;
      vi.mocked(listPayments).mockImplementation(async () => {
        lookups += 1;
        if (lookups === 2) releaseLookups();
        await lookupGate;
        return { data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100 } as never;
      });
      let claims = 0;
      vi.mocked(markOutboundRemoteRequested).mockImplementation(async () => {
        claims += 1;
        return claims === 1;
      });
      vi.mocked(createAsaasPayment).mockResolvedValue({ success: true, data: { id: 'payment-one' } } as never);

      const input = {
        contaId: 'conta-1', actor: { type: 'USER' as const, id: 'user-1' },
        payer: { type: 'responsavel' as const, responsavelId: 'resp-1' }, chargeType: 'ONE_TIME' as const,
        billingType: 'PIX' as const, value: 100, dueDate: '2099-12-01', uiRequestId: 'shared-ui-request-1',
      };
      const results = await Promise.all([createStandaloneCharge(input), createStandaloneCharge(input)]);

      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(createAttempts).toBe(2); // a colisão é rejeitada e converge para a única linha já reservada
      expect(localCharge).toEqual({ id: 'charge-1' });
      expect(createAsaasPayment).toHaveBeenCalledTimes(1);
      expect(reserveOutboundFinancialOperation).toHaveBeenCalledTimes(2);
      expect(vi.mocked(reserveOutboundFinancialOperation).mock.calls[0]?.[0].idempotencyKey)
        .toBe(vi.mocked(reserveOutboundFinancialOperation).mock.calls[1]?.[0].idempotencyKey);
      expect(listPayments).toHaveBeenCalledTimes(2);
      expect(vi.mocked(listPayments).mock.calls.every(([, options]) => options?.contaId === 'conta-1')).toBe(true);
      expect(getPayment).toHaveBeenCalledWith('payment-one', { contaId: 'conta-1' });
    });
  });

  describe('Resolução de pagador para aluno', () => {
    it('deve retornar erro quando aluno menor não tem responsável financeiro', async () => {
      const { prisma } = await import('@alusa/database');

      // Aluno menor sem responsável
      vi.mocked(prisma.aluno.findFirst).mockResolvedValueOnce({
        id: 'aluno-1',
        dataNasc: new Date('2015-01-01'), // menor de idade
        responsaveis: [], // sem responsável
      } as never);

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'aluno', alunoId: 'aluno-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('RESPONSAVEL_OBRIGATORIO_MENOR');
      }
    });

    it('deve resolver pagador para responsável quando aluno é menor', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');

      // Aluno menor COM responsável
      vi.mocked(prisma.aluno.findFirst).mockResolvedValueOnce({
        id: 'aluno-1',
        nome: 'Keison Alencar',
        dataNasc: new Date('2015-01-01'), // menor de idade
        responsaveis: [
          { responsavelId: 'resp-principal', tipoVinculo: 'PRINCIPAL', responsavel: { id: 'resp-principal', financeiro: true } },
          { responsavelId: 'resp-1', tipoVinculo: 'FINANCEIRO', responsavel: { id: 'resp-1', financeiro: false } },
        ],
      } as never);

      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Vera Lucia',
      } as never);

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);

      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_1', externalReference: 'ref' },
      } as never);

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);

      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_123' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'aluno', alunoId: 'aluno-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(true);

      // Verificar que ensureCustomer foi chamado com RESPONSAVEL
      expect(ensureCustomer).toHaveBeenCalledWith({
        contaId: 'conta-1',
        payer: { type: 'RESPONSAVEL', id: 'resp-1' },
      });
      expect(prisma.aluno.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'aluno-1', contaId: 'conta-1' },
        select: expect.objectContaining({
          responsaveis: expect.objectContaining({ where: expect.objectContaining({
            contaId: 'conta-1', responsavel: { contaId: 'conta-1' },
          }) }),
        }),
      }));

      expect(prisma.charge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payerName: 'Vera Lucia',
            payerType: 'RESPONSAVEL',
            payerId: 'resp-1',
          }),
        }),
      );
    });

    it('deve usar o próprio aluno como pagador quando maior de idade', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');

      // Aluno maior de idade
      vi.mocked(prisma.aluno.findFirst)
        .mockResolvedValueOnce({
        id: 'aluno-1',
        dataNasc: new Date('2000-01-01'), // maior de idade
        responsaveis: [],
      } as never)
        .mockResolvedValueOnce({
          nome: 'Aluno 1',
        } as never);

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);

      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_aluno', localCustomerId: 'cust_local_2', externalReference: 'ref' },
      } as never);

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);

      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_123' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'aluno', alunoId: 'aluno-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(true);

      // Verificar que ensureCustomer foi chamado com ALUNO
      expect(ensureCustomer).toHaveBeenCalledWith({
        contaId: 'conta-1',
        payer: { type: 'ALUNO', id: 'aluno-1' },
      });
    });
  });

  describe('Validações de entrada', () => {
    it('deve aceitar billingType UNDEFINED para ONE_TIME sem enfileirar', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_3', externalReference: 'ref' },
      } as never);

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_123' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'UNDEFINED',
        value: 100,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('OPEN');
      }
    });

    it('deve retornar erro quando valor é inválido para ONE_TIME', async () => {
      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 0,
        dueDate: '2099-12-01',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('VALOR_INVALIDO');
      }
    });

    it('deve retornar erro quando falta data de vencimento', async () => {
      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        // dueDate ausente
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('DATA_INVALIDA');
      }
    });

    it('deve retornar erro quando falta ciclo para SUBSCRIPTION', async () => {
      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'SUBSCRIPTION',
        billingType: 'PIX',
        value: 100,
        nextDueDate: '2099-12-01',
        endDate: '2100-12-01',
        // cycle ausente
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('CICLO_OBRIGATORIO');
      }
    });

    it('deve aceitar UNDEFINED para SUBSCRIPTION (segue validação de ciclo)', async () => {
      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'SUBSCRIPTION',
        billingType: 'UNDEFINED',
        value: 120,
        nextDueDate: '2099-12-01',
        endDate: '2100-12-01',
        // cycle ausente
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('CICLO_OBRIGATORIO');
      }
    });
  });

  describe('Notificações', () => {
    it('deve criar a cobrança com aviso quando WhatsApp não for suportado pelo Asaas', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { syncCustomerNotificationsForUserSelection } = await import(
        '../../services/sync-customer-notifications-at-charge'
      );

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_4', externalReference: 'ref' },
      } as never);

      vi.mocked(syncCustomerNotificationsForUserSelection).mockResolvedValueOnce({
        success: true,
        applied: { email: true, sms: true, whatsapp: false },
        warnings: [
          {
            notificationId: 'not_1',
            event: 'PAYMENT_CREATED',
            channel: 'whatsapp',
            code: 'invalid_action',
            message: 'Evento não suporta notificação por WhatsApp',
          },
        ],
      });

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_123' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
        notificationChannels: ['EMAIL', 'SMS', 'WHATSAPP'],
        notificationChannelsConfigured: true,
      });

      expect(result.success).toBe(true);
      expect(ensureCustomerNotificationsEnabledMock).toHaveBeenCalledWith(
        'conta-1',
        'cust_asaas_123',
      );
      expect(syncCustomerNotificationsForUserSelection).toHaveBeenCalled();
      if (result.success) {
        expect(result.data.notificationSync?.applied.whatsapp).toBe(false);
        expect(result.data.notificationSync?.warnings.length).toBeGreaterThan(0);
      }
    });

    it('não cria cobrança quando o bloqueio global não pode ser removido', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_4', externalReference: 'ref' },
      } as never);
      ensureCustomerNotificationsEnabledMock.mockResolvedValueOnce({
        success: false,
        reason: 'Customer permanece bloqueado',
      });

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
        notificationChannels: ['EMAIL'],
        notificationChannelsConfigured: true,
      });

      expect(result).toEqual({ success: false, error: 'NOTIFICACOES_NAO_CONFIGURADAS' });
      const { createAsaasPayment } = await import('../create-payment');
      expect(vi.mocked(createAsaasPayment)).not.toHaveBeenCalled();
    });

    it('deve permitir desabilitar todos os canais quando a configuração foi confirmada', async () => {
      const { prisma } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createAsaasPayment } = await import('../create-payment');
      const { syncCustomerNotificationsForUserSelection } = await import(
        '../../services/sync-customer-notifications-at-charge'
      );

      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-1',
        contratoAtualId: 'cont-1',
      } as never);
      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_5', externalReference: 'ref' },
      } as never);

      vi.mocked(syncCustomerNotificationsForUserSelection).mockResolvedValueOnce({
        success: true,
        applied: { email: false, sms: false, whatsapp: false },
        warnings: [],
      });

      vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({ id: 'cobranca-1' } as never);
      vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'charge-1' } as never);
      vi.mocked(createAsaasPayment).mockResolvedValueOnce({
        success: true,
        data: { id: 'pay_asaas_456' },
      } as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 100,
        dueDate: '2099-12-01',
        notificationChannels: [],
        notificationChannelsConfigured: true,
      });

      expect(result.success).toBe(true);
      expect(syncCustomerNotificationsForUserSelection).toHaveBeenCalledWith(
        'conta-1',
        'cust_asaas_123',
        {
          email: false,
          sms: false,
          whatsapp: false,
        },
      );
      expect(ensureCustomerNotificationsEnabledMock).not.toHaveBeenCalled();
    });
  });

  describe('Assinatura manual', () => {
    it('envia confirmação de identidade divergente da assinatura para reconciliação crítica', async () => {
      vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
      vi.stubEnv('PLAYWRIGHT_TEST', 'false');
      vi.stubEnv('NODE_ENV', 'development');
      const { prisma, loadAsaasCredentials } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createSubscription } = await import('@alusa/asaas');
      const { getSubscription } = await import('../asaas-ops');
      const outbound = await import('../outbound-financial-operation');

      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({ nome: 'Responsável 1' } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_4', externalReference: 'ref' },
      } as never);
      vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
      vi.mocked(createSubscription).mockResolvedValueOnce({
        id: 'sub_asaas_mismatch', status: 'ACTIVE', deleted: false,
      } as never);
      vi.mocked(getSubscription).mockResolvedValueOnce({
        id: 'sub_asaas_mismatch', status: 'ACTIVE', deleted: false,
        externalReference: 'wrong-reference', customer: 'cust_asaas_123',
      } as never);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          id: 'sub_manual_mismatch', status: 'REQUESTED', asaasSubscriptionId: null,
          externalReference: 'alusa:standalone-subscription:sub_manual_mismatch', description: 'Mensalidade manual',
          billingType: 'CREDIT_CARD', customerId: 'cust_local_4', familyGroupId: null,
        }] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          id: 'sub_manual_mismatch', status: 'REQUESTED', asaasSubscriptionId: null,
          externalReference: 'alusa:standalone-subscription:sub_manual_mismatch', description: 'Mensalidade manual',
          billingType: 'CREDIT_CARD', customerId: 'cust_local_4', familyGroupId: null,
        }] as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1', actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' }, chargeType: 'SUBSCRIPTION',
        billingType: 'CREDIT_CARD', value: 65.55, nextDueDate: '2099-12-01', endDate: '2100-12-01',
        cycle: 'MONTHLY', description: 'Mensalidade manual', uiRequestId: 'manual-subscription-mismatch',
      });

      expect(result).toEqual({ success: false, error: 'ERRO_AO_CRIAR_PAGAMENTO' });
      expect(outbound.markOutboundRequiresReconciliation).toHaveBeenCalledWith(expect.objectContaining({
        resource: 'SUBSCRIPTION', error: 'REMOTE_SUBSCRIPTION_CONFIRMATION_MISMATCH',
      }));
      expect(outbound.markOutboundResultUnknown).not.toHaveBeenCalled();
      vi.mocked(prisma.$queryRaw).mockReset();
    });

    it('deve criar assinatura mesmo sem delegate standaloneSubscription no runtime', async () => {
      // Este caso valida a integração real (mockada) com o cliente Asaas.
      // O .env.test ativa o provider mock para os demais testes, portanto o
      // cenário precisa declarar explicitamente o modo que está exercitando.
      vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
      vi.stubEnv('PLAYWRIGHT_TEST', 'false');
      vi.stubEnv('NODE_ENV', 'development');
      const { prisma, loadAsaasCredentials } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createSubscription, listSubscriptionPayments } = await import('@alusa/asaas');
      const { listPayments, listSubscriptions } = await import('../asaas-ops');
      const { syncPaymentStateFromAsaas } = await import('../sync-payment-state-from-asaas');

      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);

      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_asaas_123', localCustomerId: 'cust_local_4', externalReference: 'ref' },
      } as never);

      vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
      vi.mocked(createSubscription).mockResolvedValueOnce({
        id: 'sub_asaas_123',
        status: 'ACTIVE',
        deleted: false,
      } as never);
      vi.mocked(listPayments)
        .mockResolvedValueOnce({
          data: Array.from({ length: 100 }, (_, index) => ({ id: index === 0 ? 'payment-other-date' : `other-date-${index}`, dueDate: '2099-11-01', status: 'PENDING' })),
          hasMore: true,
          totalCount: 101, offset: 0, limit: 100,
        } as never)
        .mockResolvedValueOnce({
          data: [{ id: 'payment-expected-date', dueDate: '2099-12-01', status: 'PENDING' }],
          hasMore: false,
          totalCount: 101, offset: 100, limit: 100,
        } as never);
      vi.mocked(listSubscriptions).mockRejectedValueOnce(new Error('transient list failure'));

      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          id: 'sub_manual_1', status: 'REQUESTED', asaasSubscriptionId: null,
          externalReference: 'alusa:standalone-subscription:sub_manual_1', description: 'Mensalidade manual',
          billingType: 'CREDIT_CARD', customerId: 'cust_local_4', familyGroupId: null,
        }] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          id: 'sub_manual_1', status: 'REQUESTED', asaasSubscriptionId: null,
          externalReference: 'alusa:standalone-subscription:sub_manual_1', description: 'Mensalidade manual',
          billingType: 'CREDIT_CARD', customerId: 'cust_local_4', familyGroupId: null,
        }] as never)
        .mockResolvedValueOnce([
          {
            id: 'sub_manual_1',
            status: 'ACTIVE',
            asaasSubscriptionId: 'sub_asaas_123',
            externalReference: 'alusa:standalone-subscription:sub_manual_1',
            description: 'Mensalidade manual',
            billingType: 'CREDIT_CARD',
            customerId: 'cust_local_4',
          },
        ] as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'SUBSCRIPTION',
        billingType: 'CREDIT_CARD',
        value: 65.55,
        nextDueDate: '2099-12-01',
        endDate: '2100-12-01',
        cycle: 'MONTHLY',
        description: 'Mensalidade manual',
        uiRequestId: 'family_'.repeat(12),
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.asaasSubscriptionId).toBe('sub_asaas_123');
      expect(result.data.status).toBe('ACTIVE');
      expect(result.data.expectedWebhooks).toEqual(['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED']);
      expect(createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^op_[a-f0-9]{40}$/),
        }),
      );
      const subscriptionCall = vi.mocked(createSubscription).mock.calls[0]?.[0];
      expect(subscriptionCall?.idempotencyKey).toHaveLength(43);
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(listSubscriptionPayments).not.toHaveBeenCalled();
      expect(listPayments).toHaveBeenCalledTimes(2);
      expect(vi.mocked(listPayments).mock.calls.map(([query]) => query.offset)).toEqual([0, 100]);
      expect(vi.mocked(syncPaymentStateFromAsaas)).toHaveBeenCalledWith({
        contaId: 'conta-1', asaasPaymentId: 'payment-expected-date',
      });
      expect(listSubscriptions).toHaveBeenCalledTimes(4);
      expect(vi.mocked(listSubscriptions).mock.calls.every(([, options]) => options?.contaId === 'conta-1')).toBe(true);
      expect(prisma.charge.upsert).not.toHaveBeenCalled();
    }, 10_000);

    it('revalida o pagador dentro do lock de idempotência', async () => {
      const { prisma, loadAsaasCredentials } = await import('@alusa/database');
      const { ensureCustomer } = await import('../ensure-customer');
      const { createSubscription } = await import('@alusa/asaas');

      vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
        nome: 'Responsável 1',
      } as never);
      vi.mocked(ensureCustomer).mockResolvedValueOnce({
        success: true,
        data: { customerId: 'cust_shared', localCustomerId: 'cust_local', externalReference: 'ref' },
      } as never);
      vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
      vi.mocked(createSubscription).mockResolvedValueOnce({
        id: 'sub_shared',
        status: 'ACTIVE',
        deleted: false,
      } as never);

      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          id: 'sub_local',
          status: 'REQUESTED',
          asaasSubscriptionId: null,
          externalReference: 'alusa:standalone-subscription:sub_local',
          description: 'Mensalidade manual',
          billingType: 'PIX',
          customerId: 'cust_local',
          familyGroupId: null,
          payerType: 'RESPONSAVEL',
          payerId: 'resp-1',
        }] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          id: 'sub_local',
          status: 'REQUESTED',
          asaasSubscriptionId: 'sub_shared',
          externalReference: 'alusa:standalone-subscription:sub_local',
          description: 'Mensalidade manual',
          billingType: 'PIX',
          customerId: 'cust_local',
          familyGroupId: null,
          payerType: 'ALUNO',
          payerId: 'aluno-1',
        }] as never);

      const result = await createStandaloneCharge({
        contaId: 'conta-1',
        actor: { type: 'USER', id: 'user-1' },
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'SUBSCRIPTION',
        billingType: 'PIX',
        value: 65,
        nextDueDate: '2099-12-01',
        endDate: '2100-12-01',
        cycle: 'MONTHLY',
        uiRequestId: 'shared-idempotency-key',
      });

      expect(result).toEqual({ success: false, error: 'PAGADOR_DIVERGENTE' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    });
  });
});
