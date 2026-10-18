import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAsaasCustomer } from '../create-customer';
import { AsaasHttpError } from '@alusa/asaas';

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: { asaasIntegrationJob: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock('../outbound-financial-operation', () => ({
  reserveOutboundFinancialOperation: vi.fn(async () => ({
    job: { id: 'job-customer' },
    payload: { state: 'INTENT_CREATED', remoteId: null },
  })),
  markOutboundRemoteRequested: vi.fn(async () => true),
  markOutboundRemoteConfirmed: vi.fn(),
  markOutboundSynchronized: vi.fn(),
  markOutboundFailed: vi.fn(),
  markOutboundResultUnknown: vi.fn(),
  markOutboundRequiresReconciliation: vi.fn(),
}));

vi.mock('../../foundation/asaas-operational-guard', () => ({
  assertAsaasTenantOperational: vi.fn(async () => ({
    contaId: 'conta-1',
    financeProfileId: 'fp-1',
    asaasAccountId: 'acc-1',
    status: 'APPROVED',
    apiKeyStatus: 'CONNECTED',
    webhookStatus: 'ACTIVE',
    operationalStatus: 'OPERATIONAL',
    hasSubaccountId: true,
    hasApiKey: true,
    apiKeyConnected: true,
    webhookActive: true,
    kycRejected: false,
    regulatoryBlocked: false,
  })),
}));

vi.mock('@alusa/asaas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/asaas')>();
  return {
    ...actual,
    createCustomer: vi.fn(),
    getCustomer: vi.fn(),
    listCustomers: vi.fn(),
    restoreCustomer: vi.fn(),
    updateCustomer: vi.fn(),
  };
});

describe('createAsaasCustomer', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { loadAsaasCredentials } = await import('@alusa/database');
    const { listCustomers, getCustomer, createCustomer, restoreCustomer, updateCustomer } = await import('@alusa/asaas');
    const {
      reserveOutboundFinancialOperation, markOutboundRemoteRequested, markOutboundRemoteConfirmed,
      markOutboundSynchronized, markOutboundFailed, markOutboundResultUnknown,
      markOutboundRequiresReconciliation,
    } = await import('../outbound-financial-operation');
    vi.mocked(listCustomers).mockReset();
    vi.mocked(getCustomer).mockReset();
    vi.mocked(createCustomer).mockReset();
    vi.mocked(restoreCustomer).mockReset();
    vi.mocked(updateCustomer).mockReset();
    vi.mocked(reserveOutboundFinancialOperation).mockReset().mockResolvedValue({
      job: { id: 'job-customer' }, payload: { state: 'INTENT_CREATED', remoteId: null },
    } as never);
    vi.mocked(markOutboundRemoteRequested).mockReset().mockResolvedValue(true);
    vi.mocked(markOutboundRemoteConfirmed).mockReset();
    vi.mocked(markOutboundSynchronized).mockReset();
    vi.mocked(markOutboundFailed).mockReset();
    vi.mocked(markOutboundResultUnknown).mockReset();
    vi.mocked(markOutboundRequiresReconciliation).mockReset();

    vi.mocked(loadAsaasCredentials).mockResolvedValue({
      apiKey: 'sandbox_key',
      contaId: 'conta-1',
    } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never);
    vi.mocked(getCustomer).mockImplementation(async ({ customerId }) => {
      const { createCustomer } = await import('@alusa/asaas');
      const data = vi.mocked(createCustomer).mock.calls.at(-1)?.[0]?.data;
      return { id: customerId, externalReference: data?.externalReference, cpfCnpj: data?.cpfCnpj, deleted: false } as never;
    });
  });

  it('rejeita documento inválido antes de consultar ou criar customer', async () => {
    const { createCustomer, getCustomer, listCustomers } = await import('@alusa/asaas');
    const { reserveOutboundFinancialOperation } = await import('../outbound-financial-operation');

    const result = await createAsaasCustomer({
      contaId: 'conta-1', name: 'Elaine Costa', cpfCnpj: '00000000000',
      externalReference: 'customer:r1',
    });

    expect(result.success).toBe(false);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(getCustomer).not.toHaveBeenCalled();
    expect(listCustomers).not.toHaveBeenCalled();
    expect(reserveOutboundFinancialOperation).not.toHaveBeenCalled();
  });

  it('envia telefone tambem como celular ao criar customer', async () => {
    const { createCustomer, getCustomer } = await import('@alusa/asaas');

    vi.mocked(createCustomer).mockResolvedValue({
      id: 'cus_1',
      externalReference: 'customer:r1',
    } as never);
    vi.mocked(getCustomer).mockResolvedValueOnce({
      id: 'cus_1', externalReference: 'customer:r1', cpfCnpj: '02719786276', deleted: false,
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      email: 'elaine@example.com',
      phone: '(92) 97981-7409',
      externalReference: 'customer:r1',
    });

    expect(result.success).toBe(true);
    expect(createCustomer).toHaveBeenCalledWith({
      apiKey: 'sandbox_key',
      data: {
        name: 'Elaine Costa',
        cpfCnpj: '02719786276',
        email: 'elaine@example.com',
        phone: '92979817409',
        mobilePhone: '92979817409',
        externalReference: 'customer:r1',
        notificationDisabled: false,
      },
    });
  });

  it('bloqueia POST quando o preflight retorna metadados de paginação inconsistentes', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    vi.mocked(listCustomers).mockResolvedValueOnce({
      data: [], hasMore: false, totalCount: 0, offset: 100, limit: 100,
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1', name: 'Elaine Costa', cpfCnpj: '02719786276',
      externalReference: 'customer:r1',
    });

    expect(result.success).toBe(false);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(listCustomers).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 100 }));
  });

  it('bloqueia POST quando totalCount contradiz hasMore=false e a página parece vazia', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    vi.mocked(listCustomers).mockResolvedValueOnce({
      data: [], hasMore: false, totalCount: 1, offset: 0, limit: 100,
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1', name: 'Elaine Costa', cpfCnpj: '02719786276',
      externalReference: 'customer:r1',
    });

    expect(result.success).toBe(false);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(listCustomers).toHaveBeenCalledTimes(1);
  });

  it('bloqueia POST quando página curta informa hasMore=true', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    vi.mocked(listCustomers).mockResolvedValueOnce({
      data: [{ id: 'cus-partial', externalReference: 'customer:r1', cpfCnpj: '02719786276' }],
      hasMore: true, totalCount: 101, offset: 0, limit: 100,
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1', name: 'Elaine Costa', cpfCnpj: '02719786276',
      externalReference: 'customer:r1',
    });

    expect(result.success).toBe(false);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(listCustomers).toHaveBeenCalledTimes(1);
  });

  it('atualiza celular em customer existente sem sobrescrever opt-out de notificações', async () => {
    const { listCustomers, updateCustomer } = await import('@alusa/asaas');

    vi.mocked(listCustomers).mockResolvedValueOnce({
      data: [
        {
          id: 'cus_1',
          externalReference: 'customer:r1',
          cpfCnpj: '02719786276',
          deleted: false,
        },
      ], hasMore: false, totalCount: 1, limit: 100, offset: 0,
    } as never);
    vi.mocked(listCustomers).mockResolvedValueOnce({
      data: [{ id: 'cus_1', externalReference: 'customer:r1', cpfCnpj: '02719786276', deleted: false }],
      hasMore: false, totalCount: 1, limit: 100, offset: 0,
    } as never);
    const { getCustomer } = await import('@alusa/asaas');
    vi.mocked(getCustomer).mockResolvedValueOnce({
      id: 'cus_1', externalReference: 'customer:r1', cpfCnpj: '02719786276', deleted: false,
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      email: 'elaine@example.com',
      phone: '(92) 97981-7409',
      externalReference: 'customer:r1',
    });

    expect(result.success).toBe(true);
    expect(updateCustomer).toHaveBeenCalledWith({
      apiKey: 'sandbox_key',
      customerId: 'cus_1',
      data: {
        name: 'Elaine Costa',
        email: 'elaine@example.com',
        phone: '92979817409',
        mobilePhone: '92979817409',
        externalReference: 'customer:r1',
      },
    });
  });

  it('nao reutiliza customer encontrado por externalReference quando CPF/CNPJ e diferente', async () => {
    const { createCustomer, listCustomers, updateCustomer } = await import('@alusa/asaas');

    vi.mocked(listCustomers)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({
        data: [
          {
            id: 'cus_antigo',
            externalReference: 'financeProfile:fp1',
            cpfCnpj: '12345678909',
            deleted: false,
          },
        ],
        hasMore: false, totalCount: 1, limit: 100, offset: 0,
      } as never);

    vi.mocked(createCustomer).mockResolvedValue({
      id: 'cus_novo',
      externalReference: 'customer:conta-1:RESPONSAVEL:r1',
    } as never);

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Luiza de Alencar Bezerra',
      cpfCnpj: '705.484.450-52',
      email: 'luiza@example.com',
      phone: '(97) 98128-3106',
      externalReference: 'customer:conta-1:RESPONSAVEL:r1',
    });

    expect(result.success).toBe(true);
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(createCustomer).toHaveBeenCalledTimes(1);
  });

  it('reusa customer criado remotamente quando o POST perde a resposta', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    vi.mocked(listCustomers)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [{
        id: 'cus_created_before_timeout',
        externalReference: 'customer:r-timeout',
        cpfCnpj: '02719786276',
        deleted: false,
      }], hasMore: false, totalCount: 1, limit: 100, offset: 0 } as never);
    const { getCustomer } = await import('@alusa/asaas');
    vi.mocked(getCustomer).mockResolvedValueOnce({
      id: 'cus_created_before_timeout', externalReference: 'customer:r-timeout',
      cpfCnpj: '02719786276', deleted: false,
    } as never);
    vi.mocked(createCustomer).mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      externalReference: 'customer:r-timeout',
    });

    expect(result).toMatchObject({ success: true, data: { id: 'cus_created_before_timeout' } });
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(listCustomers).toHaveBeenCalledTimes(4);
    expect(listCustomers).toHaveBeenLastCalledWith({
      apiKey: 'sandbox_key', externalReference: 'customer:r-timeout', offset: 0, limit: 100,
    });
  });

  it('retorna erro ambíguo quando a consulta após timeout falha', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    vi.mocked(listCustomers)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.mocked(createCustomer).mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      externalReference: 'customer:r-uncertain',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Resultado do POST incerto');
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(listCustomers).toHaveBeenCalledTimes(4);
  });

  it('não escolhe customer arbitrário quando há múltiplas correspondências exatas', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    vi.mocked(listCustomers)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [
        { id: 'cus_duplicate_a', externalReference: 'customer:r-duplicate', cpfCnpj: '02719786276', deleted: false },
        { id: 'cus_duplicate_b', externalReference: 'customer:r-duplicate', cpfCnpj: '027.197.862-76', deleted: false },
      ], hasMore: false, totalCount: 2, limit: 100, offset: 0 } as never);
    vi.mocked(createCustomer).mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      externalReference: 'customer:r-duplicate',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('reconciliação necessária');
    expect(createCustomer).toHaveBeenCalledTimes(0);
    expect(listCustomers).toHaveBeenCalledTimes(3);
  });

  it('mantém falha ambígua quando o lookup pós-POST não encontra correspondência', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    vi.mocked(listCustomers)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never)
      .mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never);
    vi.mocked(createCustomer).mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      externalReference: 'customer:r-not-found',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('Resultado do POST incerto');
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(listCustomers).toHaveBeenCalledTimes(4);
  });

  it('preserva rejeição definitiva 4xx sem consulta pós-criação', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    vi.mocked(createCustomer).mockRejectedValueOnce(new AsaasHttpError('Invalid customer', 400));

    const result = await createAsaasCustomer({
      contaId: 'conta-1',
      name: 'Elaine Costa',
      cpfCnpj: '02719786276',
      externalReference: 'customer:r-invalid',
    });

    expect(result.success).toBe(false);
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(listCustomers).toHaveBeenCalledTimes(3);
  });

  it('não repete POST na chamada seguinte quando o mesmo job permanece RESULT_UNKNOWN', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    const { reserveOutboundFinancialOperation } = await import('../outbound-financial-operation');
    vi.mocked(reserveOutboundFinancialOperation).mockResolvedValue({
      job: { id: 'same-unknown-job' },
      payload: { state: 'RESULT_UNKNOWN', remoteId: null },
    } as never);
    vi.mocked(listCustomers).mockResolvedValue({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never);

    const params = {
      contaId: 'conta-1', apiKey: 'sandbox_key', payerIdentity: { type: 'RESPONSAVEL' as const, id: 'resp-1' },
      data: { name: 'Elaine Costa', cpfCnpj: '02719786276', externalReference: 'customer:conta-1:RESPONSAVEL:resp-1' },
    };
    const { createCustomerWithOutboundOperation } = await import('../create-customer');
    const first = await createCustomerWithOutboundOperation(params);
    const second = await createCustomerWithOutboundOperation(params);

    expect(first).toMatchObject({ ok: false, disposition: 'UNKNOWN' });
    expect(second).toMatchObject({ ok: false, disposition: 'UNKNOWN' });
    expect(reserveOutboundFinancialOperation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(reserveOutboundFinancialOperation).mock.calls[0]?.[0]).toMatchObject({
      contaId: 'conta-1', idempotencyKey: expect.any(String), requestFingerprint: expect.any(String),
    });
    expect(vi.mocked(reserveOutboundFinancialOperation).mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: vi.mocked(reserveOutboundFinancialOperation).mock.calls[0]?.[0].idempotencyKey,
      requestFingerprint: vi.mocked(reserveOutboundFinancialOperation).mock.calls[0]?.[0].requestFingerprint,
    });
    expect(createCustomer).not.toHaveBeenCalled();
    expect(listCustomers).toHaveBeenCalledTimes(2);
  });

  it('compartilha claim entre chamadas concorrentes do mesmo payer e envia um POST', async () => {
    const { createCustomer, listCustomers } = await import('@alusa/asaas');
    const { reserveOutboundFinancialOperation, markOutboundRemoteRequested } = await import('../outbound-financial-operation');
    const { createCustomerWithOutboundOperation } = await import('../create-customer');
    let releaseLookups!: () => void;
    const lookupGate = new Promise<void>((resolve) => { releaseLookups = resolve; });
    let lookupCount = 0;
    vi.mocked(listCustomers).mockImplementation(async () => {
      lookupCount += 1;
      if (lookupCount === 2) releaseLookups();
      await lookupGate;
      return { data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never;
    });
    let claims = 0;
    vi.mocked(markOutboundRemoteRequested).mockImplementation(async () => {
      claims += 1;
      return claims === 1;
    });
    vi.mocked(reserveOutboundFinancialOperation).mockResolvedValue({
      job: { id: 'same-customer-job' }, payload: { state: 'INTENT_CREATED', remoteId: null },
    } as never);
    vi.mocked(createCustomer).mockResolvedValue({ id: 'cus_concurrent' } as never);

    const params = {
      contaId: 'conta-1', apiKey: 'sandbox_key', payerIdentity: { type: 'RESPONSAVEL' as const, id: 'resp-1' },
      data: { name: 'Elaine Costa', cpfCnpj: '02719786276', externalReference: 'customer:conta-1:RESPONSAVEL:resp-1' },
    };
    const results = await Promise.all([
      createCustomerWithOutboundOperation(params),
      createCustomerWithOutboundOperation(params),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(reserveOutboundFinancialOperation).toHaveBeenCalledTimes(2);
    expect(markOutboundRemoteRequested).toHaveBeenCalledTimes(2);
    expect(vi.mocked(markOutboundRemoteRequested).mock.calls).toEqual([
      ['same-customer-job'], ['same-customer-job'],
    ]);
    expect(vi.mocked(reserveOutboundFinancialOperation).mock.calls[0]?.[0].idempotencyKey)
      .toBe(vi.mocked(reserveOutboundFinancialOperation).mock.calls[1]?.[0].idempotencyKey);
    expect(vi.mocked(reserveOutboundFinancialOperation).mock.calls[0]?.[0].requestFingerprint)
      .toBe(vi.mocked(reserveOutboundFinancialOperation).mock.calls[1]?.[0].requestFingerprint);
  });

  it('exige que GET confirme o mesmo ID retornado pelo POST', async () => {
    const { createCustomer, getCustomer, listCustomers } = await import('@alusa/asaas');
    const { markOutboundRemoteRequested, markOutboundRequiresReconciliation } = await import('../outbound-financial-operation');
    vi.mocked(markOutboundRemoteRequested).mockResolvedValue(true);
    vi.mocked(listCustomers).mockResolvedValueOnce({ data: [], hasMore: false, totalCount: 0, limit: 100, offset: 0 } as never);
    vi.mocked(createCustomer).mockResolvedValueOnce({ id: 'cus_post' } as never);
    vi.mocked(getCustomer).mockResolvedValueOnce({
      id: 'cus_different', externalReference: 'customer:conta-1:RESPONSAVEL:resp-1',
      cpfCnpj: '02719786276', deleted: false,
    } as never);

    const { createCustomerWithOutboundOperation } = await import('../create-customer');
    const result = await createCustomerWithOutboundOperation({
      contaId: 'conta-1', apiKey: 'sandbox_key', payerIdentity: { type: 'RESPONSAVEL', id: 'resp-1' },
      data: { name: 'Elaine Costa', cpfCnpj: '02719786276', externalReference: 'customer:conta-1:RESPONSAVEL:resp-1' },
    });

    expect(result).toMatchObject({ ok: false, disposition: 'RECONCILIATION' });
    expect(markOutboundRequiresReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      error: 'CUSTOMER_POST_GET_ID_MISMATCH',
    }));
  });
});
