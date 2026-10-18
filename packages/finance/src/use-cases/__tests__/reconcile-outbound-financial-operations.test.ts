import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  jobs: { findMany: vi.fn(), update: vi.fn() },
  chargeUpdateMany: vi.fn(),
  transaction: vi.fn(async (items: unknown[]) => Promise.all(items)),
  listPayments: vi.fn(),
  listSubscriptions: vi.fn(),
  getSubscription: vi.fn(),
  listCustomers: vi.fn(),
  getInstallment: vi.fn(),
  getPayment: vi.fn(),
  loadCredentials: vi.fn(),
  customerUpdateMany: vi.fn(),
  syncPayment: vi.fn(),
  linkEventRegistrationCharge: vi.fn(),
  settleEventRegistrationCharge: vi.fn(),
  markConfirmed: vi.fn(),
  markSynchronized: vi.fn(),
  markUnknown: vi.fn(),
  markRequires: vi.fn(),
  resolveIssue: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: mocks.loadCredentials,
  prisma: {
    asaasIntegrationJob: mocks.jobs,
    charge: { updateMany: mocks.chargeUpdateMany },
    subscription: { updateMany: vi.fn() },
    standaloneSubscription: { updateMany: vi.fn() },
    installmentPlan: { updateMany: vi.fn() },
    standaloneInstallmentPlan: { updateMany: vi.fn() },
    customer: { updateMany: mocks.customerUpdateMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@alusa/asaas', () => ({ listPayments: mocks.listPayments, listCustomers: mocks.listCustomers, getCustomer: vi.fn() }));
vi.mock('../asaas-ops', () => ({
  listPayments: mocks.listPayments,
  listSubscriptions: mocks.listSubscriptions,
  getSubscription: mocks.getSubscription,
  getInstallment: mocks.getInstallment,
  getPayment: mocks.getPayment,
}));
vi.mock('../sync-payment-state-from-asaas', () => ({
  syncPaymentStateFromAsaas: mocks.syncPayment,
}));
vi.mock('../../events/reconcile-event-registration-charge', () => ({
  linkReconciledEventRegistrationCharge: mocks.linkEventRegistrationCharge,
  settleReconciledEventRegistrationCharge: mocks.settleEventRegistrationCharge,
}));
vi.mock('../outbound-financial-operation', async () => {
  const actual = await vi.importActual<typeof import('../outbound-financial-operation')>('../outbound-financial-operation');
  return {
    ...actual,
    markOutboundRemoteConfirmed: mocks.markConfirmed,
    markOutboundSynchronized: mocks.markSynchronized,
    markOutboundResultUnknown: mocks.markUnknown,
    markOutboundRequiresReconciliation: mocks.markRequires,
  };
});
vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  buildFinanceReconciliationIssueDedupeKey: vi.fn(() => 'dedupe-1'),
  resolveFinanceReconciliationIssueByDedupe: mocks.resolveIssue,
}));

import { reconcileOutboundFinancialOperations } from '../reconcile-outbound-financial-operations';

const operationPayload = {
  version: 1,
  state: 'RESULT_UNKNOWN',
  resource: 'PAYMENT',
  entityId: 'charge-1',
  externalReference: 'alusa:standalone:charge-1',
  correlationId: 'idem-1',
  requestFingerprint: 'fingerprint-1',
};
const page = <T>(data: T[], offset: number, totalCount: number, hasMore: boolean) => ({
  data, offset, limit: 100, totalCount, hasMore,
});

describe('reconcileOutboundFinancialOperations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recupera POST com resposta perdida pela externalReference e converge o estado local', async () => {
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-1', contaId: 'tenant-a', type: 'CREATE_PAYMENT', status: 'PROCESSING',
      attempts: 1, chargeId: 'charge-1', payload: operationPayload,
    }]);
    mocks.listPayments.mockResolvedValueOnce(page([{ id: 'pay-1', externalReference: operationPayload.externalReference, status: 'PENDING', invoiceUrl: 'https://invoice' }], 0, 1, false));
    mocks.syncPayment.mockResolvedValueOnce({ success: true, paymentStatus: 'PENDING' });

    const result = await reconcileOutboundFinancialOperations({ contaId: 'tenant-a' });

    expect(result).toEqual({ scanned: 1, recovered: 1, missing: 0, divergent: 0 });
    expect(mocks.jobs.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'tenant-a' }),
    }));
    expect(mocks.chargeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'tenant-a' }),
      data: expect.objectContaining({ asaasPaymentId: 'pay-1' }),
    }));
    expect(mocks.syncPayment).toHaveBeenCalledWith({
      contaId: 'tenant-a', asaasPaymentId: 'pay-1', intent: 'RECONCILIATION',
    });
    expect(mocks.linkEventRegistrationCharge).toHaveBeenCalledWith({
      contaId: 'tenant-a',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      asaasInstallmentId: undefined,
    });
    expect(mocks.settleEventRegistrationCharge).toHaveBeenCalledWith({
      contaId: 'tenant-a', chargeId: 'charge-1', paymentStatus: 'PENDING',
    });
    expect(mocks.markSynchronized).toHaveBeenCalledWith('job-1', 'pay-1', expect.any(Object));
  });

  it('não encerra a reconciliação se a projeção local do pagamento falhar', async () => {
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-1', contaId: 'tenant-a', type: 'CREATE_PAYMENT', status: 'PROCESSING',
      attempts: 1, chargeId: 'charge-1', payload: operationPayload,
    }]);
    mocks.listPayments.mockResolvedValueOnce(page([{ id: 'pay-1', externalReference: operationPayload.externalReference, status: 'PENDING' }], 0, 1, false));
    mocks.syncPayment.mockResolvedValueOnce({ success: false, error: 'WEBHOOK_APPLY_FAILED' });

    const result = await reconcileOutboundFinancialOperations({ contaId: 'tenant-a' });

    expect(result).toEqual({ scanned: 1, recovered: 0, missing: 0, divergent: 1 });
    expect(mocks.markRequires).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a',
      error: expect.objectContaining({ message: 'PAYMENT_STATE_SYNC_FAILED:WEBHOOK_APPLY_FAILED' }),
    }));
    expect(mocks.markSynchronized).not.toHaveBeenCalled();
    expect(mocks.settleEventRegistrationCharge).not.toHaveBeenCalled();
  });

  it('não escolhe arbitrariamente quando o Asaas contém duplicidade', async () => {
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-1', contaId: 'tenant-b', type: 'CREATE_PAYMENT', status: 'PROCESSING',
      attempts: 1, chargeId: 'charge-1', payload: operationPayload,
    }]);
    mocks.listPayments.mockResolvedValueOnce(page([
        { id: 'pay-1', externalReference: operationPayload.externalReference },
        { id: 'pay-2', externalReference: operationPayload.externalReference },
      ], 0, 2, false));

    const result = await reconcileOutboundFinancialOperations({ contaId: 'tenant-b' });

    expect(result.divergent).toBe(1);
    expect(mocks.chargeUpdateMany).not.toHaveBeenCalled();
    expect(mocks.markRequires).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-b',
      error: expect.objectContaining({ message: 'MULTIPLE_REMOTE_PAYMENTS_FOR_EXTERNAL_REFERENCE' }),
    }));
  });

  it('pagina até encontrar payment na página seguinte e só então confirma', async () => {
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-1', contaId: 'tenant-a', type: 'CREATE_PAYMENT', status: 'PROCESSING',
      attempts: 1, chargeId: 'charge-1', payload: operationPayload,
    }]);
    mocks.listPayments
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ({ id: `page-one-${index}`, externalReference: 'other-reference' })), 0, 101, true))
      .mockResolvedValueOnce(page([{ id: 'pay-page-two', externalReference: operationPayload.externalReference, status: 'PENDING' }], 100, 101, false));
    mocks.syncPayment.mockResolvedValueOnce({ success: true, paymentStatus: 'PENDING' });

    const result = await reconcileOutboundFinancialOperations();

    expect(result.recovered).toBe(1);
    expect(mocks.listPayments).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0, limit: 100 }), { contaId: 'tenant-a' });
    expect(mocks.listPayments).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 100, limit: 100 }), { contaId: 'tenant-a' });
  });

  it('não incrementa tentativas nem conclui ausência quando a paginação falha', async () => {
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-1', contaId: 'tenant-a', type: 'CREATE_PAYMENT', status: 'PROCESSING',
      attempts: 1, chargeId: 'charge-1', payload: operationPayload,
    }]);
    mocks.listPayments.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ({
      id: index === 0 ? 'pay-partial' : `filler-${index}`, externalReference: operationPayload.externalReference,
    })), 0, 101, true));
    mocks.listPayments.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await reconcileOutboundFinancialOperations();

    expect(result).toEqual({ scanned: 1, recovered: 0, missing: 0, divergent: 1 });
    expect(mocks.jobs.update).not.toHaveBeenCalled();
    expect(mocks.markRequires).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ message: 'provider unavailable' }),
    }));
    expect(mocks.syncPayment).not.toHaveBeenCalled();
  });

  it('reconcilia CUSTOMER por referência e fingerprint do documento, sem acessar ramo de installments', async () => {
    const customerPayload = {
      ...operationPayload,
      resource: 'CUSTOMER',
      entityId: 'customer:tenant-a:RESPONSAVEL:r1',
      externalReference: 'customer:tenant-a:RESPONSAVEL:r1',
      metadata: { cpfCnpjFingerprint: 'doc-hash' },
    };
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-customer', contaId: 'tenant-a', type: 'CREATE_CUSTOMER', status: 'PROCESSING',
      attempts: 1, payload: customerPayload,
    }]);
    mocks.loadCredentials.mockResolvedValueOnce({ apiKey: 'tenant-a-key' });
    mocks.listCustomers.mockResolvedValueOnce(page([{ id: 'cus-1', name: 'Responsável', cpfCnpj: '123.456.789-01', externalReference: customerPayload.externalReference }], 0, 1, false));
    const { hashPayload } = await import('../../core');
    customerPayload.metadata.cpfCnpjFingerprint = hashPayload('12345678901');

    const result = await reconcileOutboundFinancialOperations();

    expect(result.recovered).toBe(1);
    expect(mocks.listCustomers).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'tenant-a-key', externalReference: customerPayload.externalReference, offset: 0, limit: 100 }));
    expect(mocks.markConfirmed).toHaveBeenCalledWith('job-customer', 'cus-1', expect.any(Object));
    expect(mocks.markSynchronized).toHaveBeenCalledWith('job-customer', 'cus-1', expect.any(Object));
    expect(mocks.getInstallment).not.toHaveBeenCalled();
  });

  it.each([
    ['ausente', undefined],
    ['inválido', 'not-a-sha256-fingerprint'],
  ])('manda CUSTOMER para reconciliação necessária quando fingerprint documental está %s', async (_label, fingerprint) => {
    const customerPayload = {
      ...operationPayload,
      resource: 'CUSTOMER',
      entityId: 'customer:tenant-a:RESPONSAVEL:r1',
      externalReference: 'customer:tenant-a:RESPONSAVEL:r1',
      metadata: fingerprint === undefined ? {} : { cpfCnpjFingerprint: fingerprint },
    };
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-customer-invalid-fingerprint', contaId: 'tenant-a', type: 'CREATE_CUSTOMER', status: 'PROCESSING',
      attempts: 1, payload: customerPayload,
    }]);

    const result = await reconcileOutboundFinancialOperations();

    expect(result).toEqual({ scanned: 1, recovered: 0, missing: 0, divergent: 1 });
    expect(mocks.listCustomers).not.toHaveBeenCalled();
    expect(mocks.markRequires).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-customer-invalid-fingerprint',
      error: expect.objectContaining({ message: 'CUSTOMER_DOCUMENT_FINGERPRINT_MISSING_OR_INVALID' }),
    }));
    expect(mocks.markConfirmed).not.toHaveBeenCalled();
    expect(mocks.markSynchronized).not.toHaveBeenCalled();
  });

  it.each([
    ['CPF diferente', [{ id: 'cus-wrong-document', cpfCnpj: '11144477735' }]],
    ['múltiplos customers', [
      { id: 'cus-duplicate-a', cpfCnpj: '12345678901' },
      { id: 'cus-duplicate-b', cpfCnpj: '123.456.789-01' },
    ]],
  ])('mantém CUSTOMER em reconciliação quando a referência exata retorna %s', async (_label, matches) => {
    const customerPayload = {
      ...operationPayload,
      resource: 'CUSTOMER',
      entityId: 'customer:tenant-a:RESPONSAVEL:r1',
      externalReference: 'customer:tenant-a:RESPONSAVEL:r1',
      metadata: { cpfCnpjFingerprint: 'doc-hash' },
    };
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: `job-customer-${String(_label).replaceAll(' ', '-')}`, contaId: 'tenant-a', type: 'CREATE_CUSTOMER',
      status: 'PROCESSING', attempts: 1, payload: customerPayload,
    }]);
    mocks.loadCredentials.mockResolvedValueOnce({ apiKey: 'tenant-a-key' });
    mocks.listCustomers.mockResolvedValueOnce(page(matches.map((match) => ({
        ...match,
        externalReference: customerPayload.externalReference,
        deleted: false,
      })), 0, matches.length, false));
    const { hashPayload } = await import('../../core');
    customerPayload.metadata.cpfCnpjFingerprint = hashPayload('12345678901');

    const result = await reconcileOutboundFinancialOperations();

    expect(result).toEqual({ scanned: 1, recovered: 0, missing: 0, divergent: 1 });
    expect(mocks.markRequires).toHaveBeenCalledWith(expect.objectContaining({
      jobId: expect.stringMatching(/^job-customer-/),
    }));
    expect(mocks.markConfirmed).not.toHaveBeenCalled();
    expect(mocks.markSynchronized).not.toHaveBeenCalled();
    expect(mocks.customerUpdateMany).not.toHaveBeenCalled();
    expect(mocks.getInstallment).not.toHaveBeenCalled();
  });

  it('busca installment em todas as páginas antes de confirmar a referência', async () => {
    const installmentPayload = { ...operationPayload, resource: 'INSTALLMENT_PLAN' };
    mocks.jobs.findMany.mockResolvedValueOnce([{
      id: 'job-installment', contaId: 'tenant-a', type: 'CREATE_INSTALLMENT', status: 'PROCESSING',
      attempts: 1, payload: installmentPayload,
    }]);
    mocks.loadCredentials.mockResolvedValueOnce({ apiKey: 'tenant-a-key' });
    mocks.listPayments
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ({ id: `pay-other-${index}`, externalReference: 'other', installment: 'inst-other' })), 0, 101, true))
      .mockResolvedValueOnce(page([{ id: 'pay-installment', externalReference: installmentPayload.externalReference, installment: 'inst-1' }], 100, 101, false));
    mocks.getInstallment.mockResolvedValueOnce({ id: 'inst-1' });

    const result = await reconcileOutboundFinancialOperations();

    expect(result.recovered).toBe(1);
    expect(mocks.listPayments).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 100, limit: 100 }));
    expect(mocks.markSynchronized).toHaveBeenCalledWith('job-installment', 'inst-1', expect.any(Object));
  });
});
