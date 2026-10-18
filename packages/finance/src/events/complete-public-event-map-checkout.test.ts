import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateOrderMany: vi.fn(),
  findOrder: vi.fn(),
  prepare: vi.fn(),
  cancelOrder: vi.fn(),
  upsertIssue: vi.fn(),
  loadCredentials: vi.fn(),
  buildResponse: vi.fn(),
  enqueueEmail: vi.fn(),
  provider: {
    listPayments: vi.fn(),
    listCustomers: vi.fn(),
    updateCustomer: vi.fn(),
    createCustomer: vi.fn(),
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    getPixQrCode: vi.fn(),
    getBankSlipBillingInfo: vi.fn(),
    deletePayment: vi.fn(),
  },
}));

vi.mock('@alusa/database', () => ({ prisma: {
  eventMapOrder: { updateMany: mocks.updateOrderMany, findFirst: mocks.findOrder },
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
} }));
vi.mock('@alusa/lib/events/map/public-event-map-checkout-persistence', () => ({ preparePublicEventMapCheckout: mocks.prepare }));
vi.mock('@alusa/lib/events/map/public-order-links', () => ({ publicOrderStatusPath: vi.fn(() => '/order/status') }));
vi.mock('./public-event-map-checkout-response', () => ({ buildPublicEventMapCheckoutResponse: mocks.buildResponse }));
vi.mock('./public-order-created-email', () => ({ enqueuePublicOrderCreatedEmail: mocks.enqueueEmail }));
vi.mock('@alusa/lib/events/map/event-map-order-operations', () => ({ cancelPublicEventMapOrder: mocks.cancelOrder }));
vi.mock('../foundation/load-decrypted-asaas-credentials', () => ({ loadDecryptedAsaasCredentials: mocks.loadCredentials }));
vi.mock('./events-finance-observability', () => ({ logEventsFinance: vi.fn() }));
vi.mock('../reconciliation/finance-reconciliation-issue.service', () => ({
  upsertFinanceReconciliationIssue: mocks.upsertIssue,
}));

import { completePublicEventMapCheckout } from './complete-public-event-map-checkout';
import { registerEventAsaasPaymentProvider } from './event-asaas-payment-provider';

const externalReference = 'event-map-order:order-1';

function checkoutInput() {
  return {
    reservationId: 'reservation-1',
    holdToken: 'hold-token-123456',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.test',
    buyerDocument: '12345678901',
    buyerPhone: '15555555555',
    whatsappConsent: true,
    paymentMethod: 'PIX' as const,
  };
}

function pending() {
  return {
    map: { contaId: 'conta-A', publicSlug: 'public-map', name: 'Map', event: { name: 'Event' }, startsAt: null },
    order: { id: 'order-1', asaasPaymentId: null, paymentStatus: null, status: 'PAYMENT_PENDING' },
    totalAmount: 20,
    expiresAt: new Date('2026-10-20T12:00:00.000Z'),
    publishedMapSchedule: { startsAt: null, startsAtLocal: null },
  };
}

function page(input: { offset: number; hasMore: boolean; data: Array<Record<string, unknown>>; totalCount?: number }) {
  const data = input.hasMore
    ? [...input.data, ...Array.from({ length: Math.max(0, 100 - input.data.length) }, (_, index) => ({
        id: `pay-page-${input.offset}-${index}`,
        externalReference: input.data[0]?.externalReference ?? externalReference,
        status: 'PENDING',
        deleted: true,
      }))]
    : input.data;
  return { ...input, data, limit: 100, totalCount: input.totalCount ?? (input.hasMore ? Math.max(101, input.offset + data.length + 1) : input.offset + data.length) };
}

function customersPage(input: { offset: number; hasMore: boolean; data: Array<Record<string, unknown>> }) {
  const data = input.hasMore
    ? [...input.data, ...Array.from({ length: Math.max(0, 100 - input.data.length) }, (_, index) => ({
        id: `cus-page-${input.offset}-${index}`,
        cpfCnpj: '99999999999',
      }))]
    : input.data;
  return { ...input, data, limit: 100, totalCount: input.hasMore ? 101 : input.offset + data.length };
}

describe('completePublicEventMapCheckout payment reference pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerEventAsaasPaymentProvider(mocks.provider as never);
    mocks.prepare.mockResolvedValue(pending());
    mocks.loadCredentials.mockResolvedValue({ apiKey: 'tenant-A-key' });
    mocks.updateOrderMany.mockResolvedValue({ count: 1 });
    mocks.findOrder
      .mockResolvedValueOnce({ asaasCustomerId: null })
      .mockResolvedValueOnce({ ...pending().order, items: [], buyerEmail: 'buyer@example.test', buyerName: 'Buyer', accessToken: 'token', invoiceUrl: null });
    mocks.buildResponse.mockImplementation((order) => ({ order }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.createCustomer.mockResolvedValue({ id: 'cus-1' });
  });

  it('recupera cobrança na página seguinte sem criar outro POST', async () => {
    const existingPayment = {
      id: 'pay-later', customer: 'cus-1', value: 20, billingType: 'PIX',
      externalReference, status: 'PENDING', deleted: false,
    };
    mocks.findOrder
      .mockReset()
      .mockResolvedValueOnce({ asaasCustomerId: 'cus-1' })
      .mockResolvedValueOnce({ ...pending().order, asaasPaymentId: 'pay-later', items: [] });
    mocks.provider.listPayments
      .mockResolvedValueOnce(page({ offset: 0, hasMore: true, data: Array.from({ length: 100 }, (_, index) => ({
        id: `deleted-${index}`, externalReference, deleted: true,
      })) }))
      .mockResolvedValueOnce(page({ offset: 100, hasMore: false, data: [existingPayment] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [{ id: 'cus-1', cpfCnpj: '12345678901' }] }));

    const result = await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(result).toMatchObject({ order: { asaasPaymentId: 'pay-later' } });
    expect(mocks.provider.listPayments.mock.calls.map(([params]) => [params.offset, params.apiKey]))
      .toEqual([[0, 'tenant-A-key'], [100, 'tenant-A-key']]);
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.provider.listPayments.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'order-1', contaId: 'conta-A', asaasPaymentId: null }),
    }));
  });

  it('atualiza dados de customer existente sem sobrescrever sua referência externa estável', async () => {
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({
      offset: 0,
      hasMore: false,
      data: [{ id: 'cus-existing', cpfCnpj: '12345678901' }],
    }));
    mocks.provider.createPayment.mockResolvedValue({
      id: 'pay-1', customer: 'cus-existing', value: 20, billingType: 'PIX',
      externalReference, status: 'PENDING',
    });
    mocks.findOrder
      .mockReset()
      .mockResolvedValueOnce({ asaasCustomerId: null })
      .mockResolvedValueOnce({ ...pending().order, asaasPaymentId: 'pay-1', items: [] });

    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.provider.updateCustomer).toHaveBeenCalledWith({
      apiKey: 'tenant-A-key',
      customerId: 'cus-existing',
      data: {
        name: 'Buyer',
        email: 'buyer@example.test',
        mobilePhone: '15555555555',
      },
    });
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
  });

  it('não cria nem cancela pedido se uma página posterior do preflight falha', async () => {
    mocks.findOrder.mockReset().mockResolvedValueOnce({ asaasPaymentId: null, paymentStatus: null });
    mocks.provider.listPayments
      .mockResolvedValueOnce(page({ offset: 0, hasMore: true, data: Array.from({ length: 100 }, (_, index) => ({
        id: `candidate-${index}`, externalReference,
      })) }))
      .mockRejectedValueOnce(new Error('temporary provider failure'));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });

    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      remoteStatus: 'REFERENCE_LOOKUP_INCOMPLETE',
    }));
    expect(mocks.provider.listPayments.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
  });

  it('não cria cobrança se hasMore continua ativo até o limite de páginas', async () => {
    mocks.findOrder.mockReset().mockResolvedValueOnce({ asaasPaymentId: null, paymentStatus: null });
    mocks.provider.listPayments.mockImplementation(async ({ offset }: { offset: number }) => page({
      offset,
      hasMore: true,
      totalCount: 10001,
      data: Array.from({ length: 100 }, (_, index) => ({
        id: `candidate-${offset}-${index}`, externalReference, deleted: true,
      })),
    }));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });

    expect(mocks.provider.listPayments).toHaveBeenCalledTimes(100);
    expect(mocks.provider.listPayments).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 9900, limit: 100 }));
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it('bloqueia candidatos duplicados ativos encontrados na página posterior', async () => {
    mocks.findOrder.mockReset();
    mocks.provider.listPayments
      .mockResolvedValueOnce(page({ offset: 0, hasMore: true, data: [
        { id: 'pay-first', customer: 'cus-1', value: 20, billingType: 'PIX', externalReference },
        ...Array.from({ length: 99 }, (_, index) => ({ id: `pay-deleted-${index}`, customer: 'cus-1', value: 20, billingType: 'PIX', externalReference, deleted: true })),
      ] }))
      .mockResolvedValueOnce(page({ offset: 100, hasMore: false, data: [{
        id: 'pay-later', customer: 'cus-1', value: 20, billingType: 'PIX', externalReference,
      }] }));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COBRANCAS_DUPLICADAS_EM_RECONCILIACAO' });

    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.provider.listPayments.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }));
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      remoteStatus: 'MULTIPLE_REMOTE_PAYMENTS',
    }));
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it('mantém checkout desconhecido sem emitir novo POST após busca completa vazia', async () => {
    mocks.prepare.mockResolvedValue({
      ...pending(),
      order: { ...pending().order, paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    });
    mocks.findOrder.mockReset().mockResolvedValueOnce({ asaasPaymentId: null, paymentStatus: 'PAYMENT_CREATION_UNKNOWN' });
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });

    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it('não persiste cobrança recuperada parcialmente após POST ambíguo', async () => {
    mocks.provider.listPayments
      .mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }))
      .mockResolvedValueOnce(page({ offset: 0, hasMore: true, data: Array.from({ length: 100 }, (_, index) => ({
        id: `candidate-${index}`, externalReference,
      })) }))
      .mockRejectedValueOnce(new Error('temporary provider failure'));
    mocks.provider.createPayment.mockRejectedValue(new Error('response lost'));
    mocks.updateOrderMany.mockResolvedValue({ count: 1 });
    mocks.findOrder.mockReset().mockResolvedValue({
      asaasPaymentId: null,
      paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
    });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toThrow('EVENT_PAYMENT_REFERENCE_LOOKUP_INCOMPLETE');

    expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);
    expect(mocks.provider.listPayments.mock.calls.map(([params]) => params.offset)).toEqual([0, 0, 100]);
    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paymentStatus: 'PAYMENT_CREATION_UNKNOWN' }),
      data: { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }));
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'CRITICAL',
      remoteStatus: 'POST_RESPONSE_LOOKUP_INCOMPLETE',
      metadata: expect.objectContaining({ lookupStatus: 'INCOMPLETE' }),
    }));
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'duplicatas',
      payments: [
        { id: 'pay-1', customer: 'cus-1', value: 20, billingType: 'PIX', externalReference },
        { id: 'pay-2', customer: 'cus-1', value: 20, billingType: 'PIX', externalReference },
      ],
      issue: 'POST_RESPONSE_MULTIPLE_PAYMENTS',
      errorCode: 'COBRANCAS_DUPLICADAS_EM_RECONCILIACAO',
    },
    {
      label: 'divergência',
      payments: [
        { id: 'pay-foreign', customer: 'cus-other', value: 20, billingType: 'PIX', externalReference },
      ],
      issue: 'POST_RESPONSE_PAYMENT_MISMATCH',
      errorCode: 'COBRANCA_DIVERGENTE_EM_RECONCILIACAO',
    },
  ])('registra issue quando o fallback pós-POST encontra $label', async ({ payments, issue, errorCode }) => {
    mocks.provider.listPayments
      .mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }))
      .mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: payments }));
    mocks.provider.createPayment.mockRejectedValue(new Error('response lost'));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: errorCode });

    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'CRITICAL', remoteStatus: issue,
    }));
    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paymentStatus: 'PAYMENT_CREATION_UNKNOWN' }),
      data: { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }));
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it('bloqueia cobrança com comprador divergente mesmo sem customerId local', async () => {
    mocks.findOrder.mockReset().mockResolvedValueOnce({ asaasCustomerId: null });
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [{
      id: 'pay-foreign-customer', customer: 'cus-other', value: 20, billingType: 'PIX', externalReference,
    }] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [{ id: 'cus-1', cpfCnpj: '12345678901' }] }));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COBRANCA_DIVERGENTE_EM_RECONCILIACAO' });

    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ remoteStatus: 'PAYMENT_MISMATCH' }));
  });

  it('bloqueia vinculação quando customer duplicado aparece na página seguinte', async () => {
    mocks.findOrder.mockReset().mockResolvedValueOnce({ asaasCustomerId: null });
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [{
      id: 'pay-found', customer: 'cus-1', value: 20, billingType: 'PIX', externalReference,
    }] }));
    mocks.provider.listCustomers
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: true, data: [
        { id: 'cus-1', cpfCnpj: '12345678901' },
        ...Array.from({ length: 99 }, (_, index) => ({ id: `cus-other-${index}`, cpfCnpj: '99999999999' })),
      ] }))
      .mockResolvedValueOnce(customersPage({ offset: 100, hasMore: false, data: [{ id: 'cus-2', cpfCnpj: '12345678901' }] }));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COBRANCA_DIVERGENTE_EM_RECONCILIACAO' });

    expect(mocks.provider.listCustomers.mock.calls.map(([params]) => [params.offset, params.apiKey]))
      .toEqual([[0, 'tenant-A-key'], [100, 'tenant-A-key']]);
    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }));
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ remoteStatus: 'BUYER_CUSTOMER_NOT_CONFIRMED' }));
  });

  it('não sobrescreve atualização concorrente ao anexar cobrança recuperada', async () => {
    mocks.findOrder
      .mockReset()
      .mockResolvedValueOnce({ asaasCustomerId: null })
      .mockResolvedValueOnce({ ...pending().order, asaasPaymentId: 'pay-webhook', items: [] });
    mocks.updateOrderMany.mockResolvedValue({ count: 0 });
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [{
      id: 'pay-found', customer: 'cus-1', value: 20, billingType: 'PIX', externalReference,
    }] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [{ id: 'cus-1', cpfCnpj: '12345678901' }] }));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });

    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-A', asaasPaymentId: null, paymentStatus: null }),
    }));
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ remoteStatus: 'LOCAL_ORDER_PAYMENT_CONFLICT' }));
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
  });

  it('mantém resposta divergente do POST em reconciliação sem fulfillment', async () => {
    mocks.findOrder.mockReset().mockResolvedValue({ asaasPaymentId: null, paymentStatus: 'PAYMENT_CREATION_UNKNOWN' });
    mocks.provider.listPayments
      .mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.createPayment.mockResolvedValue({
      id: 'pay-wrong', customer: 'cus-1', value: 19, billingType: 'PIX', externalReference,
      status: 'PENDING',
    });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COBRANCA_DIVERGENTE_EM_RECONCILIACAO' });

    expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);
    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }));
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ remoteStatus: 'POST_RESPONSE_MISMATCH' }));
    expect(mocks.enqueueEmail).not.toHaveBeenCalled();
  });
});
