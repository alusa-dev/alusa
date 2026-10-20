import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateOrderMany: vi.fn(),
  findOrder: vi.fn(),
  findResponsibles: vi.fn(),
  findCustomerForPayer: vi.fn(),
  findIssueForOrder: vi.fn(),
  resolveCustomerIssue: vi.fn(),
  casUpdateOrder: vi.fn(),
  casFindOrder: vi.fn(),
  dbFindResponsibles: vi.fn(),
  useDatabaseCas: false,
  useRealTransaction: false,
  realTransaction: null as null | ((callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>),
  prepare: vi.fn(),
  cancelOrder: vi.fn(),
  upsertIssue: vi.fn(),
  loadCredentials: vi.fn(),
  buildResponse: vi.fn(),
  confirmEventMapOrderPayment: vi.fn(),
  reconcileEventMapOrderPayment: vi.fn(),
  enqueueTicketEmail: vi.fn(),
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
  eventMapOrder: {
    updateMany: (args: unknown) => mocks.useDatabaseCas ? mocks.casUpdateOrder(args) : mocks.updateOrderMany(args),
    findFirst: (args: unknown) => mocks.useDatabaseCas ? mocks.casFindOrder(args) : mocks.findOrder(args),
  },
  responsavel: { findMany: (args: unknown) => mocks.useDatabaseCas ? mocks.dbFindResponsibles(args) : mocks.findResponsibles(args) },
  financeReconciliationIssue: {
    findFirst: (args: unknown) => mocks.findIssueForOrder(args),
    updateMany: (args: unknown) => mocks.resolveCustomerIssue(args),
  },
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    mocks.useRealTransaction && mocks.realTransaction ? mocks.realTransaction(callback) : callback({})),
} }));
vi.mock('@alusa/lib/events/map/public-event-map-checkout-persistence', () => ({ preparePublicEventMapCheckout: mocks.prepare }));
vi.mock('@alusa/lib/events/map/public-order-links', () => ({
  publicOrderStatusPath: vi.fn(() => '/order/status'),
  publicOrderTicketsPath: vi.fn(() => '/order/tickets'),
}));
vi.mock('./public-event-map-checkout-response', () => ({ buildPublicEventMapCheckoutResponse: mocks.buildResponse }));
vi.mock('./public-order-created-email', () => ({ enqueuePublicOrderCreatedEmail: mocks.enqueueEmail }));
vi.mock('./confirm-public-event-map-order-payment', () => ({ confirmPublicEventMapOrderPayment: mocks.confirmEventMapOrderPayment }));
vi.mock('./event-map-payment-transitions', () => ({ reconcileEventMapOrderFinancialStateFromAsaas: mocks.reconcileEventMapOrderPayment }));
vi.mock('../core/idempotency.service', () => ({
  withSessionAdvisoryLock: async ({ fn }: { fn: () => Promise<unknown> }) => fn(),
}));
vi.mock('@alusa/lib/events/map/event-map-order-operations', () => ({
  parseEventMapOrderExternalReference: (reference: string | null | undefined) => reference?.startsWith('event-map-order:') ? reference.slice('event-map-order:'.length) : null,
  cancelPublicEventMapOrder: mocks.cancelOrder,
  lockEventMapForReservation: vi.fn(async () => true),
  lockPublicEventMapReservation: vi.fn(async () => true),
  findEventMapOrderForPayment: async (tx: { eventMapOrder: { findFirst: (args: unknown) => Promise<unknown> } }, input: { contaId: string; asaasPaymentId: string; externalReference?: string | null }) => tx.eventMapOrder.findFirst({
    where: {
      contaId: input.contaId,
      OR: [
        { asaasPaymentId: input.asaasPaymentId },
        ...(input.externalReference?.startsWith('event-map-order:') ? [{ id: input.externalReference.slice('event-map-order:'.length) }] : []),
      ],
    },
    select: { id: true, reservationId: true, asaasPaymentId: true },
  }),
  syncPublicLotQuantity: vi.fn(async () => undefined),
  decimal: (value: unknown) => value,
  toAuditJson: (value: unknown) => value,
  toMoney: (value: unknown) => Number(value ?? 0),
}));
vi.mock('@alusa/lib/events/ticket-email-outbox', () => ({ enqueueEventTicketEmail: mocks.enqueueTicketEmail }));
vi.mock('@alusa/lib/events/ticket-whatsapp-notification', () => ({ enqueueEventTicketWhatsAppNotification: vi.fn(async () => undefined) }));
vi.mock('../foundation/load-decrypted-asaas-credentials', () => ({ loadDecryptedAsaasCredentials: mocks.loadCredentials }));
vi.mock('./events-finance-observability', () => ({ logEventsFinance: vi.fn() }));
vi.mock('../reconciliation/finance-reconciliation-issue.service', () => ({
  upsertFinanceReconciliationIssue: mocks.upsertIssue,
}));
vi.mock('../customer/customer-identity', () => ({
  findCustomerForPayer: mocks.findCustomerForPayer,
}));

import { beginEventMapPaymentCancellation, completePublicEventMapCheckout, recordFailedEventMapPaymentCancellation, recordSuccessfulEventMapPaymentCancellation } from './complete-public-event-map-checkout';
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

async function createDatabaseCheckoutFixture(db: typeof import('@alusa/database').prisma) {
  const tag = crypto.randomUUID();
  const conta = await db.conta.create({ data: { nome: `Checkout concurrency ${tag}` } });
  const event = await db.schoolEvent.create({ data: {
    contaId: conta.id, name: `Event ${tag}`, type: 'CULTURAL_SHOW', status: 'ACTIVE',
    startsAt: new Date(Date.now() + 86_400_000), ticketMode: 'NUMBERED_SEATS', hasTickets: true,
  } });
  const map = await db.eventMap.create({ data: {
    contaId: conta.id, eventId: event.id, name: 'Map', status: 'PUBLISHED', publicSlug: `checkout-${tag}`,
    publicEnabled: true,
  } });
  const version = await db.eventMapVersion.create({ data: {
    contaId: conta.id, eventMapId: map.id, version: 1, status: 'PUBLISHED', snapshot: { startsAt: new Date(Date.now() + 86_400_000).toISOString() },
  } });
  await db.eventMap.update({ where: { id: map.id }, data: { publishedVersionId: version.id } });
  const seat = await db.eventMapPublicSeat.create({ data: {
    contaId: conta.id, eventId: event.id, eventMapId: map.id, versionId: version.id,
    originalSeatId: `seat-${tag}`, sectionName: 'A', unitPrice: 20, technicalCode: `A-${tag}`,
    displayLabel: 'A1', status: 'HELD', x: 0, y: 0,
  } });
  const reservation = await db.eventMapReservation.create({ data: {
    contaId: conta.id, eventId: event.id, eventMapId: map.id, versionId: version.id,
    holdToken: `hold-${tag}`, status: 'HELD', expiresAt: new Date(Date.now() + 300_000),
  } });
  await db.eventMapReservationSeat.create({ data: { contaId: conta.id, reservationId: reservation.id, publicSeatId: seat.id } });
  const order = await db.eventMapOrder.create({ data: {
    contaId: conta.id, eventId: event.id, eventMapId: map.id, versionId: version.id, reservationId: reservation.id,
    buyerName: 'Buyer', buyerEmail: 'buyer@example.test', buyerDocument: '12345678901', buyerPhone: '15555555555',
    totalAmount: 20, status: 'PAYMENT_PENDING', paymentProvider: 'ASAAS', paymentMethod: 'PIX',
    paymentStatus: null, expiresAt: reservation.expiresAt, accessToken: `order-${tag}`,
  } });
  return { conta, event, map, version, seat, reservation, order };
}

describe('completePublicEventMapCheckout payment reference pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDatabaseCas = false;
    mocks.useRealTransaction = false;
    mocks.realTransaction = null;
    registerEventAsaasPaymentProvider(mocks.provider as never);
    mocks.prepare.mockResolvedValue(pending());
    mocks.confirmEventMapOrderPayment.mockResolvedValue({ orderId: 'order-1', status: 'CONFIRMED', ticketsCreated: 1 });
    mocks.reconcileEventMapOrderPayment.mockResolvedValue({ orderId: 'order-1', status: 'CONFIRMED', financialOnly: true });
    mocks.loadCredentials.mockResolvedValue({ apiKey: 'tenant-A-key' });
    mocks.updateOrderMany.mockResolvedValue({ count: 1 });
    mocks.findOrder
      .mockResolvedValueOnce({ asaasCustomerId: null })
      .mockResolvedValueOnce({ ...pending().order, items: [], buyerEmail: 'buyer@example.test', buyerName: 'Buyer', accessToken: 'token', invoiceUrl: null });
    mocks.findResponsibles.mockResolvedValue([]);
    mocks.findCustomerForPayer.mockResolvedValue(null);
    mocks.findIssueForOrder.mockResolvedValue(null);
    mocks.resolveCustomerIssue.mockResolvedValue({ count: 0 });
    mocks.upsertIssue.mockResolvedValue(undefined);
    mocks.buildResponse.mockImplementation((order) => ({ order }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.createCustomer.mockResolvedValue({ id: 'cus-1' });
  });

  it('retries the idempotent order email enqueue when the payment is already attached', async () => {
    const attachedOrder = {
      ...pending().order,
      asaasPaymentId: 'pay-attached',
      paymentMethod: 'PIX',
      buyerEmail: 'buyer@example.test',
      buyerName: 'Buyer',
      accessToken: 'stable-token',
      invoiceUrl: 'https://invoice.test/pay-attached',
      expiresAt: new Date('2026-10-20T12:00:00.000Z'),
    };
    mocks.prepare.mockResolvedValueOnce({ ...pending(), order: attachedOrder });

    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.enqueueEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      contaId: 'conta-A', orderId: 'order-1', buyerEmail: 'buyer@example.test',
      statusPath: '/order/status', invoiceUrl: 'https://invoice.test/pay-attached',
    }));
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
  });

  it('does not claim cancellation when DELETED wins the status compare-and-set race', async () => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder.mockResolvedValue({ id: 'order-race', status: 'EXPIRED', paymentStatus: 'PENDING' });
    mocks.casUpdateOrder.mockImplementation(async (args) => {
      const query = args as { where: { paymentStatus?: string }; data: { paymentStatus?: string } };
      expect(query.where.paymentStatus).toBe('PENDING');
      expect(query.data.paymentStatus).toBe('CANCELLATION_IN_PROGRESS');
      // A PAYMENT_DELETED webhook commits after the stale read and before CAS.
      return { count: 0 };
    });

    await expect(beginEventMapPaymentCancellation({
      contaId: 'conta-1', orderId: 'order-race', paymentId: 'pay-race', orderStatus: 'EXPIRED',
    })).resolves.toBe(false);
    expect(mocks.casUpdateOrder).toHaveBeenCalledTimes(1);
    expect(mocks.upsertIssue).not.toHaveBeenCalled();
  });

  it('keeps a restored payment under review when GET DELETED is stale at finalization', async () => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-restore', status: 'EXPIRED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'EXPIRED', paymentStatus: 'PENDING' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    mocks.findIssueForOrder.mockResolvedValue({
      remoteStatus: 'RECEIVED', metadata: { cancellationRestoreObserved: true },
    });
    mocks.provider.getPayment.mockResolvedValue({ id: 'pay-restore', status: 'PENDING' });

    await expect(recordSuccessfulEventMapPaymentCancellation({
      contaId: 'conta-1', orderId: 'order-restore', paymentId: 'pay-restore', orderStatus: 'EXPIRED',
      apiKey: 'tenant-key', remoteStatus: 'PENDING',
    })).resolves.toEqual({ latePaymentFulfilled: false });
    expect(mocks.casUpdateOrder).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: 'PENDING' },
    }));
    expect(mocks.resolveCustomerIssue).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'order-restore', remoteStatus: 'RECEIVED', severity: 'HIGH',
      metadata: expect.objectContaining({ cancellationInProgress: true, reason: 'payment_received_during_order_cancellation' }),
    }));
    expect(mocks.confirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
  });

  it('keeps post-RESTORED paid GET visible when DELETE response is terminal DELETED', async () => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-restored-after-delete', status: 'EXPIRED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'EXPIRED', paymentStatus: 'DELETED' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    mocks.provider.getPayment
      .mockResolvedValueOnce({ id: 'pay-restored-after-delete', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'pay-restored-after-delete', status: 'RECEIVED', value: 20 });
    // No prior paid issue observation: RECEIVED is known only from the
    // authoritative post-RESTORED provider read.
    mocks.findIssueForOrder.mockResolvedValue({ remoteStatus: 'PENDING', metadata: { cancellationRestoreObserved: true } });

    await expect(recordSuccessfulEventMapPaymentCancellation({
      contaId: 'conta-1', orderId: 'order-restored-after-delete', paymentId: 'pay-restored-after-delete', orderStatus: 'EXPIRED',
      apiKey: 'tenant-key', remoteStatus: 'DELETED',
    })).resolves.toEqual({ latePaymentFulfilled: false });

    expect(mocks.casUpdateOrder).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: 'DELETED' },
    }));
    expect(mocks.resolveCustomerIssue).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'order-restored-after-delete', remoteStatus: 'RECEIVED', severity: 'HIGH',
    }));
    expect(mocks.confirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mocks.reconcileEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
  });

  it('uses a post-restore paid GET to confirm EXPIRED orders with available seats', async () => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-restore-paid', status: 'EXPIRED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'EXPIRED', paymentStatus: 'RECEIVED' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    mocks.findIssueForOrder.mockResolvedValue({ remoteStatus: 'RECEIVED', metadata: { cancellationRestoreObserved: true } });
    mocks.provider.getPayment.mockResolvedValue({
      id: 'pay-restore-paid', status: 'RECEIVED', value: 20, paymentDate: new Date().toISOString(),
    });

    await expect(recordSuccessfulEventMapPaymentCancellation({
      contaId: 'conta-1', orderId: 'order-restore-paid', paymentId: 'pay-restore-paid', orderStatus: 'EXPIRED',
      apiKey: 'tenant-key', remoteStatus: 'PENDING',
    })).resolves.toEqual({ latePaymentFulfilled: true });
    expect(mocks.confirmEventMapOrderPayment).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasPaymentId: 'pay-restore-paid', paymentStatus: 'RECEIVED', allowReleasedReservation: true,
    }));
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'order-restore-paid', remoteStatus: 'RECEIVED', severity: 'HIGH',
    }));
  });

  it('re-reads after observing RESTORED when the first GET predates the received webhook', async () => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-restore-race', status: 'EXPIRED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'EXPIRED', paymentStatus: 'RECEIVED' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    // The first GET is stale PENDING. The issue marker is observed before the
    // merge, so the second GET must be authoritative for this attempt.
    mocks.provider.getPayment
      .mockResolvedValueOnce({ id: 'pay-restore-race', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'pay-restore-race', status: 'RECEIVED', value: 20, paymentDate: new Date().toISOString() });
    mocks.findIssueForOrder.mockResolvedValue({ remoteStatus: 'RECEIVED', metadata: { cancellationRestoreObserved: true } });

    await expect(recordSuccessfulEventMapPaymentCancellation({
      contaId: 'conta-1', orderId: 'order-restore-race', paymentId: 'pay-restore-race', orderStatus: 'EXPIRED',
      apiKey: 'tenant-key', remoteStatus: 'PENDING',
    })).resolves.toEqual({ latePaymentFulfilled: true });
    expect(mocks.provider.getPayment).toHaveBeenCalledTimes(2);
    expect(mocks.casUpdateOrder).toHaveBeenCalledWith(expect.objectContaining({ data: { paymentStatus: 'RECEIVED' } }));
    expect(mocks.confirmEventMapOrderPayment).toHaveBeenCalledWith(expect.objectContaining({
      asaasPaymentId: 'pay-restore-race', paymentStatus: 'RECEIVED',
    }));
  });

  it('re-reads after RESTORED on failed DELETE and confirms a post-marker receipt', async () => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-failed-restore-race', status: 'EXPIRED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'EXPIRED', paymentStatus: 'RECEIVED' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    mocks.provider.getPayment
      .mockResolvedValueOnce({ id: 'pay-failed-restore-race', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'pay-failed-restore-race', status: 'RECEIVED', value: 20, paymentDate: new Date().toISOString() });
    mocks.findIssueForOrder.mockResolvedValue({ remoteStatus: 'RECEIVED', metadata: { cancellationRestoreObserved: true } });

    await expect(recordFailedEventMapPaymentCancellation({
      contaId: 'conta-1', orderId: 'order-failed-restore-race', paymentId: 'pay-failed-restore-race', orderStatus: 'EXPIRED',
      apiKey: 'tenant-key', paymentStatus: 'PENDING', error: new Error('delete failed'),
    })).resolves.toEqual({ latePaymentFulfilled: true });
    expect(mocks.provider.getPayment).toHaveBeenCalledTimes(2);
    expect(mocks.casUpdateOrder).toHaveBeenCalledWith(expect.objectContaining({ data: { paymentStatus: 'RECEIVED' } }));
    expect(mocks.confirmEventMapOrderPayment).toHaveBeenCalledWith(expect.objectContaining({
      asaasPaymentId: 'pay-failed-restore-race', paymentStatus: 'RECEIVED', allowReleasedReservation: true,
    }));
  });

  it.each(['success', 'failure'] as const)('resolves cancellation issue when post-RESTORED GET confirms DELETED (%s)', async (outcome) => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-restored-deleted', status: 'CANCELLED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'CANCELLED', paymentStatus: 'DELETED' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    mocks.provider.getPayment
      .mockResolvedValueOnce({ id: 'pay-restored-deleted', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'pay-restored-deleted', deleted: true, status: 'DELETED' });
    mocks.findIssueForOrder.mockResolvedValue({ remoteStatus: 'PENDING', metadata: { cancellationRestoreObserved: true } });
    const result = outcome === 'success'
      ? recordSuccessfulEventMapPaymentCancellation({
          contaId: 'conta-1', orderId: 'order-restored-deleted', paymentId: 'pay-restored-deleted', orderStatus: 'CANCELLED',
          apiKey: 'tenant-key', remoteStatus: 'DELETED',
        })
      : recordFailedEventMapPaymentCancellation({
          contaId: 'conta-1', orderId: 'order-restored-deleted', paymentId: 'pay-restored-deleted', orderStatus: 'CANCELLED',
          apiKey: 'tenant-key', paymentStatus: 'PENDING', error: new Error('delete failed'),
        });

    await expect(result).resolves.toEqual({ latePaymentFulfilled: false });
    expect(mocks.casUpdateOrder).toHaveBeenCalledWith(expect.objectContaining({ data: { paymentStatus: 'DELETED' } }));
    expect(mocks.resolveCustomerIssue).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RESOLVED', remoteStatus: 'DELETED' }),
    }));
    expect(mocks.confirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('keeps a paid issue open when cancellation finalizer sees DELETED (%s)', async (outcome) => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-paid-marker', status: 'EXPIRED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'EXPIRED', paymentStatus: 'DELETED' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    mocks.provider.getPayment.mockResolvedValue({ id: 'pay-paid-marker', status: 'DELETED', deleted: true });
    mocks.findIssueForOrder.mockResolvedValue({ remoteStatus: 'RECEIVED', metadata: { cancellationInProgress: true } });
    const result = outcome === 'success'
      ? recordSuccessfulEventMapPaymentCancellation({
          contaId: 'conta-1', orderId: 'order-paid-marker', paymentId: 'pay-paid-marker', orderStatus: 'EXPIRED',
          apiKey: 'tenant-key', remoteStatus: 'DELETED',
        })
      : recordFailedEventMapPaymentCancellation({
          contaId: 'conta-1', orderId: 'order-paid-marker', paymentId: 'pay-paid-marker', orderStatus: 'EXPIRED',
          apiKey: 'tenant-key', paymentStatus: 'DELETED', error: new Error('delete failed'),
        });

    await expect(result).resolves.toEqual({ latePaymentFulfilled: false });
    expect(mocks.casUpdateOrder).toHaveBeenCalledWith(expect.objectContaining({ data: { paymentStatus: 'DELETED' } }));
    expect(mocks.resolveCustomerIssue).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'order-paid-marker', remoteStatus: 'RECEIVED', severity: 'HIGH',
    }));
    expect(mocks.confirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
  });

  it('reconciles a post-restore paid GET when EXPIRED seats are unavailable', async () => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-restore-reconcile', status: 'EXPIRED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'EXPIRED', paymentStatus: 'RECEIVED' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    mocks.findIssueForOrder.mockResolvedValue({ remoteStatus: 'RECEIVED', metadata: { cancellationRestoreObserved: true } });
    mocks.confirmEventMapOrderPayment.mockResolvedValueOnce(null);
    mocks.provider.getPayment.mockResolvedValue({ id: 'pay-restore-reconcile', status: 'RECEIVED', value: 20 });

    await expect(recordSuccessfulEventMapPaymentCancellation({
      contaId: 'conta-1', orderId: 'order-restore-reconcile', paymentId: 'pay-restore-reconcile', orderStatus: 'EXPIRED',
      apiKey: 'tenant-key', remoteStatus: 'PENDING',
    })).resolves.toEqual({ latePaymentFulfilled: false });
    expect(mocks.reconcileEventMapOrderPayment).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasPaymentId: 'pay-restore-reconcile', paymentStatus: 'RECEIVED',
      ticketFulfillmentError: 'PAYMENT_RECEIVED_DURING_CANCELLATION',
    }));
    expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
  });

  it('keeps a post-restore paid GET financial-only for CANCELLED orders', async () => {
    mocks.useDatabaseCas = true;
    mocks.casFindOrder
      .mockResolvedValueOnce({ id: 'order-restore-cancelled', status: 'CANCELLED', paymentStatus: 'CANCELLATION_IN_PROGRESS' })
      .mockResolvedValueOnce({ status: 'CANCELLED', paymentStatus: 'RECEIVED' });
    mocks.casUpdateOrder.mockResolvedValue({ count: 1 });
    mocks.findIssueForOrder.mockResolvedValue({ remoteStatus: 'RECEIVED', metadata: { cancellationRestoreObserved: true } });
    mocks.provider.getPayment.mockResolvedValue({ id: 'pay-restore-cancelled', status: 'RECEIVED', value: 20 });

    await expect(recordSuccessfulEventMapPaymentCancellation({
      contaId: 'conta-1', orderId: 'order-restore-cancelled', paymentId: 'pay-restore-cancelled', orderStatus: 'CANCELLED',
      apiKey: 'tenant-key', remoteStatus: 'DELETED',
    })).resolves.toEqual({ latePaymentFulfilled: false });
    expect(mocks.confirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mocks.reconcileEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'order-restore-cancelled', remoteStatus: 'RECEIVED', severity: 'HIGH',
    }));
  });

  it('does not enqueue a payment CTA after webhook fulfillment consumed the reservation', async () => {
    const attachedOrder = {
      ...pending().order, id: 'order-consumed', contaId: 'conta-A', reservationId: 'reservation-1',
      asaasPaymentId: 'pay-email-recovery', paymentStatus: 'RECEIVED', status: 'CONFIRMED',
      paymentMethod: 'PIX', buyerEmail: 'buyer@example.test', buyerName: 'Buyer', accessToken: 'stable-token',
      invoiceUrl: 'https://invoice.test/pay-email-recovery', expiresAt: new Date('2026-10-20T12:00:00.000Z'),
    };
    let failFirstEnqueue = true;
    mocks.prepare
      .mockResolvedValueOnce({ ...pending(), order: { ...pending().order, asaasPaymentId: 'pay-email-recovery', status: 'PAYMENT_PENDING' } })
      .mockResolvedValue({ ...pending(), order: attachedOrder });
    mocks.enqueueEmail.mockImplementation(async (_tx, params) => {
      if (failFirstEnqueue) {
        failFirstEnqueue = false;
        throw new Error('outbox unavailable');
      }
      return { count: 1 } as never;
    });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput())).rejects.toThrow('outbox unavailable');
    // The webhook has consumed the reservation and confirmed the persisted order;
    // checkout's recovery read returns that order without requiring HELD inventory.
    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .resolves.toMatchObject({ order: { id: 'order-consumed', status: 'CONFIRMED', asaasPaymentId: 'pay-email-recovery' } });
    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.enqueueEmail).toHaveBeenCalledTimes(1);
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
  });

  it('recupera cobrança na página seguinte sem criar outro POST', async () => {
    const existingPayment = {
      id: 'pay-later', customer: 'cus-1', value: 20, billingType: 'PIX',
      externalReference, status: 'PENDING', deleted: false,
    };
    mocks.findOrder
      .mockReset()
      .mockResolvedValueOnce({ asaasCustomerId: 'cus-1' })
      .mockResolvedValueOnce({
        ...pending().order, asaasPaymentId: 'pay-later', items: [], paymentMethod: 'PIX',
        buyerEmail: 'buyer@example.test', buyerName: 'Buyer', accessToken: 'stable-token',
        invoiceUrl: 'https://invoice.test/pay-later', expiresAt: pending().expiresAt,
      });
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
    expect(mocks.enqueueEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      contaId: 'conta-A', orderId: 'order-1', buyerEmail: expect.any(String),
    }));
    expect(mocks.provider.listPayments.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'order-1', contaId: 'conta-A', asaasPaymentId: null }),
    }));
  });

  it('resolve o alerta legado de cobrança incerta quando o pedido já persiste a cobrança confirmada', async () => {
    mocks.prepare.mockResolvedValueOnce({
      ...pending(),
      order: {
        ...pending().order,
        asaasPaymentId: 'pay-persisted',
        asaasCustomerId: 'cus-canonical',
        paymentMethod: 'PIX',
        paymentStatus: 'PENDING',
        items: [],
      },
    });
    mocks.findIssueForOrder.mockResolvedValueOnce({ id: 'issue-legacy', remoteStatus: 'NOT_FOUND' });
    mocks.provider.getPayment.mockResolvedValueOnce({
      id: 'pay-persisted', customer: 'cus-canonical', value: 20, billingType: 'PIX',
      externalReference, status: 'PENDING', deleted: false,
    });

    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.provider.getPayment).toHaveBeenCalledWith({ apiKey: 'tenant-A-key', paymentId: 'pay-persisted' });
    expect(mocks.resolveCustomerIssue).toHaveBeenCalledWith({
      where: {
        id: 'issue-legacy',
        contaId: 'conta-A',
        entityType: 'PAYMENT',
        entityId: 'order-1',
        issueType: 'BILLING_OPERATION_UNCERTAIN',
        dedupeKey: 'BILLING_OPERATION_UNCERTAIN:PAYMENT:order-1',
        status: 'OPEN',
        remoteStatus: 'NOT_FOUND',
        metadata: { path: ['externalReference'], equals: externalReference },
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: expect.any(Date),
        resolution: 'The persisted Asaas payment was verified against the checkout order.',
      },
    });
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.provider.listPayments).not.toHaveBeenCalled();
  });

  it('preserves an open attachment conflict even when the order has a local payment ID', async () => {
    mocks.prepare.mockResolvedValueOnce({
      ...pending(),
      order: {
        ...pending().order,
        asaasPaymentId: 'pay-local',
        asaasCustomerId: 'cus-canonical',
        paymentMethod: 'PIX',
        paymentStatus: 'PENDING',
        items: [],
      },
    });
    mocks.findIssueForOrder.mockResolvedValueOnce({ id: 'issue-conflict', remoteStatus: 'POST_ATTACH_CONFLICT' });

    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.provider.getPayment).not.toHaveBeenCalled();
    expect(mocks.resolveCustomerIssue).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['different payment ID', { id: 'pay-other' }],
    ['different external reference', { externalReference: 'event-map-order:other-order' }],
    ['different customer', { customer: 'cus-other' }],
    ['different payment method', { billingType: 'BOLETO' }],
    ['different amount', { value: 21 }],
    ['deleted payment', { deleted: true }],
    ['missing remote status', { status: undefined }],
  ])('keeps the uncertainty issue open when the Asaas payment does not match (%s)', async (_label, mismatch) => {
    mocks.prepare.mockResolvedValueOnce({
      ...pending(),
      order: {
        ...pending().order,
        asaasPaymentId: 'pay-persisted',
        asaasCustomerId: 'cus-canonical',
        paymentMethod: 'PIX',
        paymentStatus: 'PENDING',
        items: [],
      },
    });
    mocks.findIssueForOrder.mockResolvedValueOnce({ id: 'issue-legacy', remoteStatus: 'NOT_FOUND' });
    mocks.provider.getPayment.mockResolvedValueOnce({
      id: 'pay-persisted', customer: 'cus-canonical', value: 20, billingType: 'PIX',
      externalReference, status: 'PENDING', deleted: false,
      ...mismatch,
    });

    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.resolveCustomerIssue).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
  });

  it('keeps the uncertainty issue open and returns the existing order when Asaas verification fails', async () => {
    mocks.prepare.mockResolvedValueOnce({
      ...pending(),
      order: {
        ...pending().order,
        asaasPaymentId: 'pay-persisted',
        asaasCustomerId: 'cus-canonical',
        paymentMethod: 'PIX',
        paymentStatus: 'PENDING',
        items: [],
      },
    });
    mocks.findIssueForOrder.mockResolvedValueOnce({ id: 'issue-legacy', remoteStatus: 'NOT_FOUND' });
    mocks.provider.getPayment.mockRejectedValueOnce(new Error('provider unavailable'));

    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.resolveCustomerIssue).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
  });

  it('reusa customer único sem alterar os contatos do cadastro compartilhado', async () => {
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

    expect(mocks.provider.updateCustomer).not.toHaveBeenCalled();
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
  });

  it('seleciona entre customers duplicados quando exatamente um coincide com o vínculo local do mesmo CPF', async () => {
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
      { id: 'cus-legacy', cpfCnpj: '12345678901' },
      { id: 'cus-canonical', cpfCnpj: '12345678901' },
    ] }));
    mocks.findResponsibles.mockResolvedValue([{ id: 'responsible-1', asaasCustomerId: 'cus-canonical' }]);
    mocks.findCustomerForPayer.mockResolvedValue({ id: 'customer-local', asaasCustomerId: 'cus-canonical' });
    mocks.provider.createPayment.mockResolvedValue({
      id: 'pay-canonical', customer: 'cus-canonical', value: 20, billingType: 'PIX', externalReference, status: 'PENDING',
    });
    mocks.findOrder.mockReset()
      .mockResolvedValueOnce({ asaasCustomerId: null })
      .mockResolvedValueOnce({ ...pending().order, asaasPaymentId: 'pay-canonical', items: [], buyerEmail: 'buyer@example.test', buyerName: 'Buyer', accessToken: 'token', invoiceUrl: null });

    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.provider.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customer: 'cus-canonical' }),
    }));
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.provider.updateCustomer).not.toHaveBeenCalled();
    expect(mocks.findResponsibles).toHaveBeenCalledWith({
      where: { contaId: 'conta-A', cpf: '12345678901' },
      select: { id: true, asaasCustomerId: true },
    });
  });

  it('bloqueia customers duplicados sem vínculo local canônico e não cria terceiro customer', async () => {
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
      { id: 'cus-legacy', cpfCnpj: '12345678901' },
      { id: 'cus-other', cpfCnpj: '12345678901' },
    ] }));
    mocks.findResponsibles.mockResolvedValue([]);
    mocks.findOrder.mockReset().mockResolvedValueOnce({ asaasCustomerId: null });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COMPRADOR_DUPLICADO_EM_RECONCILIACAO' });

    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ remoteStatus: 'DUPLICATE_BUYER_CUSTOMERS' }));
  });

  it('uses canonical Customer identity when the Responsible legacy pointer is null', async () => {
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
      { id: 'cus-canonical', cpfCnpj: '12345678901' },
    ] }));
    mocks.findResponsibles.mockResolvedValue([{ id: 'responsible-identity', asaasCustomerId: null }]);
    mocks.findCustomerForPayer.mockResolvedValue({ id: 'customer-local', asaasCustomerId: 'cus-canonical' });
    mocks.provider.createPayment.mockResolvedValue({
      id: 'pay-canonical-identity', customer: 'cus-canonical', value: 20, billingType: 'PIX', externalReference, status: 'PENDING',
    });
    mocks.findOrder.mockReset()
      .mockResolvedValueOnce({ asaasCustomerId: null })
      .mockResolvedValueOnce({ ...pending().order, asaasPaymentId: 'pay-canonical-identity', items: [] });

    await completePublicEventMapCheckout('public-map', checkoutInput());

    expect(mocks.findCustomerForPayer).toHaveBeenCalledWith('conta-A', 'RESPONSAVEL', 'responsible-identity');
    expect(mocks.provider.createPayment).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customer: 'cus-canonical' }),
    }));
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
  });

  it('blocks conflicting canonical and Responsible customer pointers for reconciliation', async () => {
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
      { id: 'cus-legacy', cpfCnpj: '12345678901' },
    ] }));
    mocks.findResponsibles.mockResolvedValue([{ id: 'responsible-conflict', asaasCustomerId: 'cus-legacy' }]);
    mocks.findCustomerForPayer.mockResolvedValue({ id: 'customer-local', asaasCustomerId: 'cus-canonical' });
    mocks.findOrder.mockReset().mockResolvedValueOnce({ asaasCustomerId: null });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COMPRADOR_EM_RECONCILIACAO' });

    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ remoteStatus: 'BUYER_CUSTOMER_IDENTITY_CONFLICT' }));
  });

  it('reconcilia vínculo local verificado quando a busca completa não encontra customer ativo', async () => {
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [] }));
    mocks.findResponsibles.mockResolvedValue([{ asaasCustomerId: 'cus-linked' }]);
    mocks.findOrder.mockReset().mockResolvedValueOnce({ asaasCustomerId: null });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COMPRADOR_EM_RECONCILIACAO' });

    expect(mocks.findResponsibles).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-A', cpf: '12345678901' },
    }));
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ remoteStatus: 'LINKED_BUYER_CUSTOMER_NOT_FOUND' }));
  });

  it('does not resolve a responsible customer linked only in another tenant', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const tenantA = await createDatabaseCheckoutFixture(db);
    const tenantB = await db.conta.create({ data: { nome: `Checkout linked customer ${crypto.randomUUID()}` } });
    try {
      await db.responsavel.create({ data: {
        contaId: tenantB.id, nome: 'Responsible B', cpf: '12345678901', email: 'b@example.test',
        telefone: '11999999999', asaasCustomerId: 'cus-canonical-B',
      } });
      mocks.useDatabaseCas = true;
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      mocks.prepare.mockResolvedValue({
        ...pending(), map: { ...pending().map, contaId: tenantA.conta.id, publicSlug: 'map-A' },
        order: { ...tenantA.order, items: [] },
      });
      mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
        { id: 'cus-canonical-B', cpfCnpj: '12345678901' },
        { id: 'cus-legacy', cpfCnpj: '12345678901' },
      ] }));

      await expect(completePublicEventMapCheckout('map-A', checkoutInput()))
        .rejects.toMatchObject({ code: 'COMPRADOR_DUPLICADO_EM_RECONCILIACAO' });

      expect(mocks.dbFindResponsibles).toHaveBeenCalledWith(expect.objectContaining({
        where: { contaId: tenantA.conta.id, cpf: '12345678901' },
      }));
      expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
      expect(mocks.provider.createPayment).not.toHaveBeenCalled();
      expect((await db.eventMapPublicSeat.findFirstOrThrow({ where: { id: tenantA.seat.id, contaId: tenantA.conta.id } })).status).toBe('HELD');
    } finally {
      await db.conta.deleteMany({ where: { id: tenantA.conta.id } });
      await db.conta.deleteMany({ where: { id: tenantB.id } });
    }
  });

  it('allows only one concurrent creation to claim the database order and POST a payment', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const fixture = await createDatabaseCheckoutFixture(db);
    try {
      const databaseExternalReference = `event-map-order:${fixture.order.id}`;
      mocks.useDatabaseCas = true;
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      mocks.prepare.mockResolvedValue({
        ...pending(), map: { ...pending().map, contaId: fixture.conta.id, publicSlug: `map-${fixture.conta.id}` },
        order: { ...fixture.order, items: [] },
      });

      let releaseLookups!: () => void;
      let lookupsReached = 0;
      const bothLookups = new Promise<void>((resolve) => { releaseLookups = resolve; });
      mocks.provider.listPayments.mockImplementation(async () => {
        lookupsReached += 1;
        if (lookupsReached === 2) releaseLookups();
        await bothLookups;
        return page({ offset: 0, hasMore: false, data: [] });
      });
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
        { id: 'cus-existing', cpfCnpj: '12345678901' },
      ] }));
      mocks.provider.createPayment.mockResolvedValue({
        id: 'pay-database-cas', customer: 'cus-existing', value: 20, billingType: 'PIX', externalReference: databaseExternalReference, status: 'PENDING',
      });

      const outcomes = await Promise.allSettled([
        completePublicEventMapCheckout(`map-${fixture.conta.id}`, checkoutInput()),
        completePublicEventMapCheckout(`map-${fixture.conta.id}`, checkoutInput()),
      ]);
      const persisted = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
      const seat = await db.eventMapPublicSeat.findFirstOrThrow({ where: { id: fixture.seat.id, contaId: fixture.conta.id } });

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);
      expect(persisted.asaasPaymentId).toBe('pay-database-cas');
      expect(persisted.paymentStatus).toBe('PENDING');
      expect(seat.status).toBe('HELD');
    } finally {
      await db.financeReconciliationIssue.deleteMany({ where: { contaId: fixture.conta.id } });
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('keeps the database claim in progress while the first Asaas POST is blocked', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const fixture = await createDatabaseCheckoutFixture(db);
    try {
      mocks.useDatabaseCas = true;
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      mocks.prepare.mockImplementation(async () => {
        const current = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
        return {
          ...pending(), map: { ...pending().map, contaId: fixture.conta.id, publicSlug: `map-${fixture.conta.id}` },
          order: { ...current, items: [] },
        };
      });
      mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
        { id: 'cus-existing', cpfCnpj: '12345678901' },
      ] }));

      let postEntered!: () => void;
      let releasePost!: () => void;
      const entered = new Promise<void>((resolve) => { postEntered = resolve; });
      const blockedPost = new Promise<void>((resolve) => { releasePost = resolve; });
      mocks.provider.createPayment.mockImplementation(async () => {
        postEntered();
        await blockedPost;
        return {
          id: 'pay-blocked-post', customer: 'cus-existing', value: 20, billingType: 'PIX',
          externalReference: `event-map-order:${fixture.order.id}`, status: 'PENDING',
        };
      });

      const firstAttempt = completePublicEventMapCheckout(`map-${fixture.conta.id}`, checkoutInput());
      await entered;
      expect((await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } })).paymentStatus)
        .toBe('PAYMENT_CREATION_IN_PROGRESS');

      await expect(completePublicEventMapCheckout(`map-${fixture.conta.id}`, checkoutInput()))
        .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });
      expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);

      releasePost();
      await expect(firstAttempt).resolves.toMatchObject({ order: { asaasPaymentId: 'pay-blocked-post' } });
      const persisted = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
      const seat = await db.eventMapPublicSeat.findFirstOrThrow({ where: { id: fixture.seat.id, contaId: fixture.conta.id } });
      expect(persisted.asaasPaymentId).toBe('pay-blocked-post');
      expect(seat.status).toBe('HELD');
    } finally {
      await db.financeReconciliationIssue.deleteMany({ where: { contaId: fixture.conta.id } });
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('preserves terminal DELETED persisted after a stale GET observed RECEIVED', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const actualConfirmation = await vi.importActual<typeof import('./confirm-public-event-map-order-payment')>('./confirm-public-event-map-order-payment');
    const fixture = await createDatabaseCheckoutFixture(db);
    try {
      mocks.useDatabaseCas = true;
      mocks.useRealTransaction = true;
      mocks.realTransaction = (callback) => db.$transaction((tx) => callback(tx));
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      mocks.confirmEventMapOrderPayment.mockImplementation((params) => actualConfirmation.confirmPublicEventMapOrderPayment(params as never));
      mocks.findIssueForOrder.mockImplementation((args) => db.financeReconciliationIssue.findFirst(args as never));
      mocks.resolveCustomerIssue.mockImplementation((args) => db.financeReconciliationIssue.updateMany(args as never));
      mocks.upsertIssue.mockImplementation(async (value) => {
        const issue = value as { contaId: string; entityId: string; asaasId: string; severity: 'HIGH'; localStatus: string; remoteStatus: string; metadata: unknown };
        const dedupeKey = `PAYMENT_NEEDS_REVIEW:PAYMENT:${issue.entityId}`;
        return db.financeReconciliationIssue.upsert({
          where: { uq_fin_recon_issue_conta_dedupe: { contaId: issue.contaId, dedupeKey } },
          create: {
            contaId: issue.contaId, entityType: 'PAYMENT', entityId: issue.entityId, asaasId: issue.asaasId,
            issueType: 'PAYMENT_NEEDS_REVIEW', severity: issue.severity, dedupeKey,
            localStatus: issue.localStatus, remoteStatus: issue.remoteStatus, metadata: issue.metadata as never,
          },
          update: { localStatus: issue.localStatus, remoteStatus: issue.remoteStatus, metadata: issue.metadata as never, lastSeenAt: new Date() },
        });
      });
      mocks.prepare.mockImplementation(async () => {
        const current = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
        return {
          ...pending(), map: { ...pending().map, contaId: fixture.conta.id, publicSlug: fixture.map.publicSlug },
          order: { ...current, items: [] },
        };
      });
      mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
        { id: 'cus-expiry-race', cpfCnpj: '12345678901' },
      ] }));
      mocks.provider.getPayment.mockImplementation(async () => {
        const dedupeKey = `PAYMENT_NEEDS_REVIEW:PAYMENT:${fixture.order.id}`;
        await db.eventMapOrder.updateMany({ where: { id: fixture.order.id, contaId: fixture.conta.id, status: 'EXPIRED' }, data: { paymentStatus: 'DELETED' } });
        await db.financeReconciliationIssue.updateMany({
          where: { contaId: fixture.conta.id, dedupeKey, status: 'OPEN' },
          data: { status: 'RESOLVED', remoteStatus: 'DELETED', resolvedAt: new Date() },
        });
        return { id: 'pay-expired-during-post', status: 'RECEIVED', value: 20, paymentDate: new Date().toISOString() };
      });
      mocks.provider.deletePayment.mockResolvedValue({ status: 'DELETED', deleted: true } as never);

      let postEntered!: () => void;
      let releasePost!: () => void;
      const entered = new Promise<void>((resolve) => { postEntered = resolve; });
      const blockedPost = new Promise<void>((resolve) => { releasePost = resolve; });
      mocks.provider.createPayment.mockImplementation(async () => {
        postEntered();
        await blockedPost;
        return {
          id: 'pay-expired-during-post', customer: 'cus-expiry-race', value: 20, billingType: 'PIX',
          externalReference: `event-map-order:${fixture.order.id}`, status: 'PENDING',
        };
      });

      const checkout = completePublicEventMapCheckout(fixture.map.publicSlug, {
        ...checkoutInput(), reservationId: fixture.reservation.id, holdToken: fixture.reservation.holdToken,
      });
      await entered;
      await db.$transaction(async (tx) => {
        await tx.eventMapOrder.updateMany({ where: { id: fixture.order.id, contaId: fixture.conta.id }, data: { status: 'EXPIRED', asaasPaymentId: 'pay-expired-during-post', paymentStatus: 'PENDING' } });
        await tx.eventMapReservation.updateMany({ where: { id: fixture.reservation.id, contaId: fixture.conta.id }, data: { status: 'EXPIRED' } });
        await tx.eventMapPublicSeat.updateMany({ where: { id: fixture.seat.id, contaId: fixture.conta.id }, data: { status: 'AVAILABLE' } });
      });
      releasePost();

      await expect(checkout).rejects.toMatchObject({ code: 'RESERVA_EXPIRADA' });
      const [order, reservation, seat, ticketCount] = await Promise.all([
        db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } }),
        db.eventMapReservation.findFirstOrThrow({ where: { id: fixture.reservation.id, contaId: fixture.conta.id } }),
        db.eventMapPublicSeat.findFirstOrThrow({ where: { id: fixture.seat.id, contaId: fixture.conta.id } }),
        db.eventTicket.count({ where: { contaId: fixture.conta.id, eventMapOrderId: fixture.order.id } }),
      ]);
      expect(order).toMatchObject({ status: 'EXPIRED', asaasPaymentId: 'pay-expired-during-post', paymentStatus: 'DELETED' });
      expect(reservation.status).toBe('EXPIRED');
      expect(seat.status).toBe('AVAILABLE');
      expect(ticketCount).toBe(0);
      const cancellationIssue = await db.financeReconciliationIssue.findFirstOrThrow({ where: { contaId: fixture.conta.id, entityId: fixture.order.id, issueType: 'PAYMENT_NEEDS_REVIEW' } });
      expect(cancellationIssue).toMatchObject({ status: 'RESOLVED', remoteStatus: 'DELETED' });
      expect(mocks.provider.deletePayment).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay-expired-during-post' }));
      expect(mocks.confirmEventMapOrderPayment).not.toHaveBeenCalled();
      expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
    } finally {
      await db.financeReconciliationIssue.deleteMany({ where: { contaId: fixture.conta.id } });
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('keeps a cancelled order terminal when a delayed pending POST follows webhook receipt', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const fixture = await createDatabaseCheckoutFixture(db);
    try {
      mocks.useDatabaseCas = true;
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      mocks.prepare.mockImplementation(async () => {
        const current = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
        return {
          ...pending(), map: { ...pending().map, contaId: fixture.conta.id, publicSlug: fixture.map.publicSlug },
          order: { ...current, items: [] },
        };
      });
      mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
        { id: 'cus-cancelled-race', cpfCnpj: '12345678901' },
      ] }));

      let postEntered!: () => void;
      let releasePost!: () => void;
      const entered = new Promise<void>((resolve) => { postEntered = resolve; });
      const blockedPost = new Promise<void>((resolve) => { releasePost = resolve; });
      mocks.provider.createPayment.mockImplementation(async () => {
        postEntered();
        await blockedPost;
        return {
          id: 'pay-cancelled-during-post', customer: 'cus-cancelled-race', value: 20, billingType: 'PIX',
          externalReference: `event-map-order:${fixture.order.id}`, status: 'PENDING',
        };
      });

      const checkout = completePublicEventMapCheckout(fixture.map.publicSlug, {
        ...checkoutInput(), reservationId: fixture.reservation.id, holdToken: fixture.reservation.holdToken,
      });
      await entered;
      await db.$transaction(async (tx) => {
        await tx.eventMapOrder.updateMany({ where: { id: fixture.order.id, contaId: fixture.conta.id }, data: { status: 'CANCELLED', paymentStatus: 'RECEIVED' } });
        await tx.eventMapReservation.updateMany({ where: { id: fixture.reservation.id, contaId: fixture.conta.id }, data: { status: 'CANCELLED' } });
        await tx.eventMapPublicSeat.updateMany({ where: { id: fixture.seat.id, contaId: fixture.conta.id }, data: { status: 'AVAILABLE' } });
      });
      releasePost();

      await expect(checkout).rejects.toMatchObject({ code: 'PEDIDO_CANCELADO' });
      const [order, reservation, seat, ticketCount] = await Promise.all([
        db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } }),
        db.eventMapReservation.findFirstOrThrow({ where: { id: fixture.reservation.id, contaId: fixture.conta.id } }),
        db.eventMapPublicSeat.findFirstOrThrow({ where: { id: fixture.seat.id, contaId: fixture.conta.id } }),
        db.eventTicket.count({ where: { contaId: fixture.conta.id, eventMapOrderId: fixture.order.id } }),
      ]);
      expect(order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'RECEIVED', asaasPaymentId: 'pay-cancelled-during-post' });
      expect(reservation.status).toBe('CANCELLED');
      expect(seat.status).toBe('AVAILABLE');
      expect(ticketCount).toBe(0);
      expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
        contaId: fixture.conta.id, entityId: fixture.order.id,
        issueType: 'PAYMENT_NEEDS_REVIEW', remoteStatus: 'RECEIVED',
      }));
      expect(mocks.provider.deletePayment).not.toHaveBeenCalled();
    } finally {
      await db.financeReconciliationIssue.deleteMany({ where: { contaId: fixture.conta.id } });
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('records an operational issue when cancelling a pending payment for a cancelled order fails', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const fixture = await createDatabaseCheckoutFixture(db);
    try {
      mocks.useDatabaseCas = true;
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      mocks.prepare.mockImplementation(async () => {
        const current = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
        return {
          ...pending(), map: { ...pending().map, contaId: fixture.conta.id, publicSlug: fixture.map.publicSlug },
          order: { ...current, items: [] },
        };
      });
      mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
        { id: 'cus-cancel-failed', cpfCnpj: '12345678901' },
      ] }));
      mocks.provider.createPayment.mockResolvedValue({
        id: 'pay-cancel-failed', customer: 'cus-cancel-failed', value: 20, billingType: 'PIX',
        externalReference: `event-map-order:${fixture.order.id}`, status: 'PENDING',
      });
      mocks.provider.deletePayment.mockImplementation(async () => {
        // Model a RECEIVED webhook winning after checkout's open-status
        // snapshot but before the provider rejects DELETE.
        await db.eventMapOrder.updateMany({
          where: { id: fixture.order.id, contaId: fixture.conta.id, status: 'CANCELLED' },
          data: { paymentStatus: 'RECEIVED' },
        });
        throw new Error('provider unavailable');
      });
      mocks.provider.getPayment.mockResolvedValue({ id: 'pay-cancel-failed', status: 'RECEIVED' });

      let postEntered!: () => void;
      let releasePost!: () => void;
      const entered = new Promise<void>((resolve) => { postEntered = resolve; });
      const blockedPost = new Promise<void>((resolve) => { releasePost = resolve; });
      mocks.provider.createPayment.mockImplementation(async () => {
        postEntered();
        await blockedPost;
        return {
          id: 'pay-cancel-failed', customer: 'cus-cancel-failed', value: 20, billingType: 'PIX',
          externalReference: `event-map-order:${fixture.order.id}`, status: 'PENDING',
        };
      });

      const checkout = completePublicEventMapCheckout(fixture.map.publicSlug, {
        ...checkoutInput(), reservationId: fixture.reservation.id, holdToken: fixture.reservation.holdToken,
      });
      await entered;
      await db.eventMapOrder.updateMany({ where: { id: fixture.order.id, contaId: fixture.conta.id }, data: { status: 'CANCELLED' } });
      await db.eventMapReservation.updateMany({ where: { id: fixture.reservation.id, contaId: fixture.conta.id }, data: { status: 'CANCELLED' } });
      await db.eventMapPublicSeat.updateMany({ where: { id: fixture.seat.id, contaId: fixture.conta.id }, data: { status: 'AVAILABLE' } });
      releasePost();

      await expect(checkout).rejects.toMatchObject({ code: 'PEDIDO_CANCELADO' });
      expect((await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } })) )
        .toMatchObject({ status: 'CANCELLED', paymentStatus: 'RECEIVED' });
      expect(mocks.provider.deletePayment).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay-cancel-failed' }));
      expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
        contaId: fixture.conta.id, entityId: fixture.order.id, asaasId: 'pay-cancel-failed',
        issueType: 'PAYMENT_NEEDS_REVIEW', localStatus: 'CANCELLED', remoteStatus: 'RECEIVED',
        causeId: 'payment-post-delete:pay-cancel-failed',
        metadata: expect.objectContaining({ deleteErrorCode: 'Error', paymentStatus: 'RECEIVED' }),
      }));
      expect(JSON.stringify(mocks.upsertIssue.mock.calls)).not.toContain('provider unavailable');
    } finally {
      await db.financeReconciliationIssue.deleteMany({ where: { contaId: fixture.conta.id } });
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('preserves terminal DELETE response over a stale GET RECEIVED snapshot', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const actualConfirmation = await vi.importActual<typeof import('./confirm-public-event-map-order-payment')>('./confirm-public-event-map-order-payment');
    const fixture = await createDatabaseCheckoutFixture(db);
    try {
      mocks.useDatabaseCas = true;
      mocks.useRealTransaction = true;
      mocks.realTransaction = (callback) => db.$transaction((tx) => callback(tx));
      mocks.findIssueForOrder.mockImplementation((args) => db.financeReconciliationIssue.findFirst(args as never));
      mocks.resolveCustomerIssue.mockImplementation((args) => db.financeReconciliationIssue.updateMany(args as never));
      mocks.upsertIssue.mockImplementation(async (value) => {
        const issue = value as { contaId: string; entityId: string; asaasId: string; severity: 'HIGH'; localStatus: string; remoteStatus: string; metadata: unknown };
        const dedupeKey = `PAYMENT_NEEDS_REVIEW:PAYMENT:${issue.entityId}`;
        return db.financeReconciliationIssue.upsert({
          where: { uq_fin_recon_issue_conta_dedupe: { contaId: issue.contaId, dedupeKey } },
          create: {
            contaId: issue.contaId, entityType: 'PAYMENT', entityId: issue.entityId, asaasId: issue.asaasId,
            issueType: 'PAYMENT_NEEDS_REVIEW', severity: issue.severity, dedupeKey,
            localStatus: issue.localStatus, remoteStatus: issue.remoteStatus, metadata: issue.metadata as never,
          },
          update: { localStatus: issue.localStatus, remoteStatus: issue.remoteStatus, metadata: issue.metadata as never, lastSeenAt: new Date() },
        });
      });
      let confirmationError: unknown;
      mocks.confirmEventMapOrderPayment.mockImplementation(async (params) => {
        try { return await actualConfirmation.confirmPublicEventMapOrderPayment(params as never); }
        catch (error) { confirmationError = error; throw error; }
      });
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      mocks.prepare.mockImplementation(async () => {
        const current = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
        return {
          ...pending(), map: { ...pending().map, contaId: fixture.conta.id, publicSlug: fixture.map.publicSlug },
          order: { ...current, items: [] },
        };
      });
      mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [
        { id: 'cus-expired-received', cpfCnpj: '12345678901' },
      ] }));
      mocks.provider.deletePayment.mockResolvedValue({ status: 'DELETED', deleted: true } as never);
      mocks.provider.getPayment.mockResolvedValue({
        id: 'pay-expired-received', status: 'RECEIVED', value: 20,
        paymentDate: new Date().toISOString(), invoiceUrl: null,
      });
      let postEntered!: () => void;
      let releasePost!: () => void;
      const entered = new Promise<void>((resolve) => { postEntered = resolve; });
      const blockedPost = new Promise<void>((resolve) => { releasePost = resolve; });
      mocks.provider.createPayment.mockImplementation(async () => {
        postEntered();
        await blockedPost;
        return {
          id: 'pay-expired-received', customer: 'cus-expired-received', value: 20, billingType: 'PIX',
          externalReference: `event-map-order:${fixture.order.id}`, status: 'PENDING',
        };
      });

      const checkout = completePublicEventMapCheckout(fixture.map.publicSlug, {
        ...checkoutInput(), reservationId: fixture.reservation.id, holdToken: fixture.reservation.holdToken,
      });
      await entered;
      await db.eventMapOrder.updateMany({ where: { id: fixture.order.id, contaId: fixture.conta.id }, data: { status: 'EXPIRED' } });
      await db.eventMapReservation.updateMany({ where: { id: fixture.reservation.id, contaId: fixture.conta.id }, data: { status: 'EXPIRED' } });
      await db.eventMapPublicSeat.updateMany({ where: { id: fixture.seat.id, contaId: fixture.conta.id }, data: { status: 'AVAILABLE' } });
      releasePost();

      await expect(checkout).rejects.toMatchObject({ code: 'RESERVA_EXPIRADA' });
      expect(confirmationError).toBeUndefined();
      expect(mocks.confirmEventMapOrderPayment).not.toHaveBeenCalled();
      expect(await db.eventTicket.count({ where: { contaId: fixture.conta.id, eventMapOrderId: fixture.order.id } })).toBe(0);
      expect((await db.eventMapPublicSeat.findFirstOrThrow({ where: { id: fixture.seat.id, contaId: fixture.conta.id } })).status).toBe('AVAILABLE');
      expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
      expect(await db.financeReconciliationIssue.findFirstOrThrow({ where: { contaId: fixture.conta.id, entityId: fixture.order.id, issueType: 'PAYMENT_NEEDS_REVIEW' } }))
        .toMatchObject({ status: 'RESOLVED', remoteStatus: 'DELETED' });
      expect(mocks.enqueueEmail).not.toHaveBeenCalled();
    } finally {
      await db.financeReconciliationIssue.deleteMany({ where: { contaId: fixture.conta.id } });
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('blocks fulfillment when PAYMENT_DELETED commits after GET and before confirmation', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const actualConfirmation = await vi.importActual<typeof import('./confirm-public-event-map-order-payment')>('./confirm-public-event-map-order-payment');
    const fixture = await createDatabaseCheckoutFixture(db);
    try {
      mocks.useDatabaseCas = true;
      mocks.useRealTransaction = true;
      mocks.realTransaction = (callback) => db.$transaction((tx) => callback(tx));
      let confirmationError: unknown;
      mocks.confirmEventMapOrderPayment.mockImplementation(async (params) => {
        // Simulate PAYMENT_DELETED committing after the finalizer's provider
        // GET and immediately before the central confirmation transaction.
        await db.eventMapOrder.updateMany({
          where: { id: fixture.order.id, contaId: fixture.conta.id, status: 'EXPIRED' },
          data: { paymentStatus: 'DELETED' },
        });
        try { return await actualConfirmation.confirmPublicEventMapOrderPayment(params as never); }
        catch (error) { confirmationError = error; throw error; }
      });
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      mocks.findIssueForOrder.mockImplementation((args) => db.financeReconciliationIssue.findFirst(args as never));
      mocks.resolveCustomerIssue.mockImplementation((args) => db.financeReconciliationIssue.updateMany(args as never));
      mocks.upsertIssue.mockImplementation(async (value) => {
        const issue = value as { contaId: string; entityId: string; asaasId: string; severity: 'HIGH'; localStatus: string; remoteStatus: string; metadata: unknown };
        const dedupeKey = `PAYMENT_NEEDS_REVIEW:PAYMENT:${issue.entityId}`;
        return db.financeReconciliationIssue.upsert({
          where: { uq_fin_recon_issue_conta_dedupe: { contaId: issue.contaId, dedupeKey } },
          create: {
            contaId: issue.contaId, entityType: 'PAYMENT', entityId: issue.entityId, asaasId: issue.asaasId,
            issueType: 'PAYMENT_NEEDS_REVIEW', severity: issue.severity, dedupeKey,
            localStatus: issue.localStatus, remoteStatus: issue.remoteStatus, metadata: issue.metadata as never,
          },
          update: { localStatus: issue.localStatus, remoteStatus: issue.remoteStatus, metadata: issue.metadata as never, lastSeenAt: new Date() },
        });
      });
      mocks.prepare.mockImplementation(async () => {
        const current = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
        return { ...pending(), map: { ...pending().map, contaId: fixture.conta.id, publicSlug: fixture.map.publicSlug }, order: { ...current, items: [] } };
      });
      mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [{ id: 'cus-expired-received-unavailable', cpfCnpj: '12345678901' }] }));
      mocks.provider.createPayment.mockResolvedValue({
        id: 'pay-expired-received-unavailable', customer: 'cus-expired-received-unavailable', value: 20, billingType: 'PIX',
        externalReference: `event-map-order:${fixture.order.id}`, status: 'PENDING',
      });
      mocks.provider.deletePayment.mockImplementation(async () => {
        throw new Error('delete response lost after webhook');
      });
      mocks.provider.getPayment.mockResolvedValue({ id: 'pay-expired-received-unavailable', status: 'RECEIVED', value: 20 });
      let postEntered!: () => void;
      let releasePost!: () => void;
      const entered = new Promise<void>((resolve) => { postEntered = resolve; });
      const blockedPost = new Promise<void>((resolve) => { releasePost = resolve; });
      mocks.provider.createPayment.mockImplementation(async () => {
        postEntered();
        await blockedPost;
        return {
          id: 'pay-expired-received-unavailable', customer: 'cus-expired-received-unavailable', value: 20, billingType: 'PIX',
          externalReference: `event-map-order:${fixture.order.id}`, status: 'PENDING',
        };
      });
      const checkout = completePublicEventMapCheckout(fixture.map.publicSlug, {
        ...checkoutInput(), reservationId: fixture.reservation.id, holdToken: fixture.reservation.holdToken,
      });
      await entered;
      await db.$transaction(async (tx) => {
        await tx.eventMapOrder.updateMany({ where: { id: fixture.order.id, contaId: fixture.conta.id }, data: { status: 'EXPIRED' } });
        await tx.eventMapReservation.updateMany({ where: { id: fixture.reservation.id, contaId: fixture.conta.id }, data: { status: 'EXPIRED' } });
        await tx.eventMapPublicSeat.updateMany({ where: { id: fixture.seat.id, contaId: fixture.conta.id }, data: { status: 'AVAILABLE' } });
      });
      releasePost();

      await expect(checkout).rejects.toMatchObject({ code: 'RESERVA_EXPIRADA' });
      const order = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
      expect(order).toMatchObject({ status: 'EXPIRED', paymentStatus: 'DELETED' });
      expect(confirmationError).toMatchObject({ code: 'PAGAMENTO_BLOQUEADO_POR_ANALISE' });
      expect(await db.eventTicket.count({ where: { contaId: fixture.conta.id, eventMapOrderId: fixture.order.id } })).toBe(0);
      expect(await db.financeWebhookSideEffectOutbox.count({ where: { contaId: fixture.conta.id, effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND' } })).toBe(0);
      expect(await db.financeReconciliationIssue.findFirstOrThrow({ where: { contaId: fixture.conta.id, entityId: fixture.order.id, issueType: 'PAYMENT_NEEDS_REVIEW' } }))
        .toMatchObject({ status: 'OPEN', remoteStatus: 'RECEIVED' });
      expect(mocks.confirmEventMapOrderPayment).toHaveBeenCalledTimes(1);
      expect(mocks.enqueueTicketEmail).not.toHaveBeenCalled();
    } finally {
      await db.financeReconciliationIssue.deleteMany({ where: { contaId: fixture.conta.id } });
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('keeps a persisted DELETED payment snapshot against a delayed RECEIVED sync', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const transitions = await vi.importActual<typeof import('./event-map-payment-transitions')>('./event-map-payment-transitions');
    const fixture = await createDatabaseCheckoutFixture(db);
    try {
      mocks.useDatabaseCas = true;
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      await db.eventMapOrder.update({ where: { id: fixture.order.id }, data: { asaasPaymentId: 'pay-terminal-deleted', paymentStatus: 'DELETED' } });

      await transitions.syncPublicEventMapOrderPaymentCreated({
        contaId: fixture.conta.id,
        asaasPaymentId: 'pay-terminal-deleted',
        externalReference: `event-map-order:${fixture.order.id}`,
        paymentStatus: 'RECEIVED',
      });

      expect(await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } }))
        .toMatchObject({ status: 'PAYMENT_PENDING', asaasPaymentId: 'pay-terminal-deleted', paymentStatus: 'DELETED' });
    } finally {
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('fences an in-flight customer POST before recovery can start a payment POST', async () => {
    const { prisma: db } = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
    const fixture = await createDatabaseCheckoutFixture(db);
    const databaseExternalReference = `event-map-order:${fixture.order.id}`;
    const acceptedCustomer = {
      id: `cus-recovered-${fixture.order.id}`,
      cpfCnpj: '12345678901',
      externalReference: databaseExternalReference,
      deleted: false,
    };
    try {
      mocks.useDatabaseCas = true;
      mocks.casUpdateOrder.mockImplementation((args) => db.eventMapOrder.updateMany(args as never));
      mocks.casFindOrder.mockImplementation((args) => db.eventMapOrder.findFirst(args as never));
      mocks.dbFindResponsibles.mockImplementation((args) => db.responsavel.findMany(args as never));
      const fixtureInput = { ...checkoutInput(), reservationId: fixture.reservation.id, holdToken: fixture.reservation.holdToken };
      mocks.prepare.mockImplementation(async () => {
        // Mirror the real persistence's unconditional expiry refresh, which
        // also advances Prisma updatedAt on every retry.
        await db.eventMapOrder.update({ where: { id: fixture.order.id }, data: { expiresAt: new Date(Date.now() + 5 * 60_000) } });
        const current = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
        return {
          ...pending(),
          map: { ...pending().map, contaId: fixture.conta.id, publicSlug: fixture.map.publicSlug },
          order: { ...current, items: [] },
          expiresAt: fixture.reservation.expiresAt,
        };
      });
      const issueDedupeKey = `BILLING_OPERATION_UNCERTAIN:PAYMENT:${fixture.order.id}`;
      await db.financeReconciliationIssue.create({ data: {
        contaId: fixture.conta.id, entityType: 'PAYMENT', entityId: fixture.order.id,
        issueType: 'BILLING_OPERATION_UNCERTAIN', severity: 'CRITICAL',
        dedupeKey: issueDedupeKey,
        detectedAt: new Date(Date.now() - 10 * 60_000),
        localStatus: 'PAYMENT_CREATION_UNKNOWN', remoteStatus: 'PAYMENT_CREATION_UNKNOWN',
        metadata: { operation: 'PAYMENT_CREATION', customerCreationPostStarted: false, externalReference: databaseExternalReference },
      } });
      mocks.findIssueForOrder.mockImplementation((args) => db.financeReconciliationIssue.findFirst(args as never));
      mocks.upsertIssue.mockImplementation(async (issueInput) => {
        const typed = issueInput as { contaId: string; metadata?: unknown; localStatus?: string | null; remoteStatus?: string | null };
        return db.financeReconciliationIssue.update({
          where: { uq_fin_recon_issue_conta_dedupe: { contaId: typed.contaId, dedupeKey: issueDedupeKey } },
          data: {
            ...(typed.metadata ? { metadata: typed.metadata as never } : {}),
            localStatus: typed.localStatus,
            remoteStatus: typed.remoteStatus,
          },
        });
      });
      mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
      let cpfLookupCount = 0;
      let externalReferenceLookupCount = 0;
      mocks.provider.listCustomers.mockImplementation(async ({ externalReference }: { externalReference?: string }) => {
        if (externalReference === databaseExternalReference) {
          externalReferenceLookupCount += 1;
          return customersPage({ offset: 0, hasMore: false, data: [acceptedCustomer] });
        }
        cpfLookupCount += 1;
        return customersPage({ offset: 0, hasMore: false, data: cpfLookupCount === 1 ? [] : [acceptedCustomer] });
      });

      let postEntered!: () => void;
      let releaseCustomerPost!: (customer: typeof acceptedCustomer) => void;
      const entered = new Promise<void>((resolve) => { postEntered = resolve; });
      const blockedPost = new Promise<typeof acceptedCustomer>((resolve) => { releaseCustomerPost = resolve; });
      mocks.provider.createCustomer.mockImplementation(async () => {
        postEntered();
        return blockedPost;
      });
      mocks.provider.createPayment.mockResolvedValue({
        id: 'pay-after-customer-fence', customer: acceptedCustomer.id, value: 20, billingType: 'PIX',
        externalReference: databaseExternalReference, status: 'PENDING',
      });

      const originalRequest = completePublicEventMapCheckout(fixture.map.publicSlug, fixtureInput);
      await entered;
      const inFlight = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
      expect(inFlight.paymentStatus).toBe('PAYMENT_CREATION_IN_PROGRESS');
      expect(inFlight.asaasCustomerId).toBeNull();

      await expect(completePublicEventMapCheckout(fixture.map.publicSlug, fixtureInput))
        .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });
      expect(externalReferenceLookupCount).toBe(0);
      expect(mocks.provider.createCustomer).toHaveBeenCalledTimes(1);
      const refreshedRecently = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
      expect(refreshedRecently.updatedAt.getTime()).toBeGreaterThan(Date.now() - 3 * 60_000);
      const reusedIssue = await db.financeReconciliationIssue.findFirstOrThrow({ where: { contaId: fixture.conta.id, dedupeKey: issueDedupeKey } });
      expect(reusedIssue.detectedAt.getTime()).toBeLessThan(Date.now() - 3 * 60_000);
      const recentMarkerAt = (reusedIssue.metadata as { customerCreationPostStartedAt: string }).customerCreationPostStartedAt;
      expect(new Date(recentMarkerAt).getTime()).toBeGreaterThan(Date.now() - 3 * 60_000);

      // Age only this attempt's marker; the old dedupe detectedAt is irrelevant.
      const agedMarkerMetadata = { ...(reusedIssue.metadata as Record<string, unknown>), customerCreationPostStartedAt: new Date(Date.now() - 4 * 60_000).toISOString() };
      await db.financeReconciliationIssue.update({
        where: { uq_fin_recon_issue_conta_dedupe: { contaId: fixture.conta.id, dedupeKey: issueDedupeKey } },
        data: { metadata: agedMarkerMetadata },
      });
      await expect(completePublicEventMapCheckout(fixture.map.publicSlug, fixtureInput))
        .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });
      expect(externalReferenceLookupCount).toBe(1);
      const fenced = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
      expect(fenced.paymentStatus).toBeNull();
      expect(fenced.asaasCustomerId).toBe(acceptedCustomer.id);
      expect(mocks.provider.createPayment).not.toHaveBeenCalled();

      releaseCustomerPost(acceptedCustomer);
      await expect(originalRequest).rejects.toMatchObject({ code: 'COMPRADOR_EM_RECONCILIACAO' });
      expect(mocks.provider.createPayment).not.toHaveBeenCalled();

      await expect(completePublicEventMapCheckout(fixture.map.publicSlug, fixtureInput))
        .resolves.toMatchObject({ order: { asaasPaymentId: 'pay-after-customer-fence' } });
      const persisted = await db.eventMapOrder.findFirstOrThrow({ where: { id: fixture.order.id, contaId: fixture.conta.id } });
      const seat = await db.eventMapPublicSeat.findFirstOrThrow({ where: { id: fixture.seat.id, contaId: fixture.conta.id } });
      expect(mocks.provider.createCustomer).toHaveBeenCalledTimes(1);
      expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);
      expect(persisted.asaasPaymentId).toBe('pay-after-customer-fence');
      expect(seat.status).toBe('HELD');
    } finally {
      await db.financeReconciliationIssue.deleteMany({ where: { contaId: fixture.conta.id } });
      await db.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
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

  it.each([
    ['ausente', undefined],
    ['inválido', 'not-an-iso-date'],
  ])('falha fechada com timestamp de tentativa %s', async (_label, customerCreationPostStartedAt) => {
    mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
    mocks.prepare.mockResolvedValue({
      ...pending(),
      order: { ...pending().order, paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' },
    });
    mocks.findIssueForOrder.mockResolvedValue({
      metadata: {
        operation: 'CUSTOMER_CREATION', customerCreationPostStarted: true,
        ...(customerCreationPostStartedAt === undefined ? {} : { customerCreationPostStartedAt }),
        externalReference,
      },
    });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });

    expect(mocks.provider.listCustomers).not.toHaveBeenCalled();
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
    expect(mocks.updateOrderMany).not.toHaveBeenCalled();
  });

  it.each([
    ['busca vazia', 'empty'],
    ['busca incompleta', 'incomplete'],
  ])('mantém UNKNOWN e sem novos POSTs quando a recuperação stale encontra %s', async (_label, lookupResult) => {
    const customerCreationPostStartedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    mocks.prepare.mockResolvedValue({
      ...pending(),
      order: { ...pending().order, paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' },
    });
    mocks.findIssueForOrder.mockResolvedValue({
      metadata: { operation: 'CUSTOMER_CREATION', customerCreationPostStarted: true, customerCreationPostStartedAt, externalReference },
    });
    mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
    if (lookupResult === 'incomplete') {
      mocks.provider.listCustomers.mockRejectedValue(new Error('provider lookup incomplete'));
    } else {
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [] }));
    }

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });

    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' }),
      data: { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }));
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      remoteStatus: lookupResult === 'empty' ? 'CUSTOMER_CREATION_UNKNOWN_NO_MATCH' : 'CUSTOMER_REFERENCE_LOOKUP_INCOMPLETE',
      metadata: expect.objectContaining({ operation: 'CUSTOMER_CREATION', customerCreationPostStarted: true }),
    }));
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['ausente com busca vazia', undefined, 'empty'],
    ['inválido com busca vazia', 'not-an-iso-date', 'empty'],
    ['inválido com busca incompleta', 'not-an-iso-date', 'incomplete'],
  ])('UNKNOWN com marker de customer e timestamp %s faz lookup exato e nunca novo POST', async (_label, customerCreationPostStartedAt, lookupResult) => {
    mocks.prepare.mockResolvedValue({
      ...pending(),
      order: { ...pending().order, paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    });
    mocks.findIssueForOrder.mockResolvedValue({
      metadata: {
        operation: 'CUSTOMER_CREATION', customerCreationPostStarted: true,
        ...(customerCreationPostStartedAt === undefined ? {} : { customerCreationPostStartedAt }),
        externalReference,
      },
    });
    mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
    if (lookupResult === 'incomplete') {
      mocks.provider.listCustomers.mockRejectedValue(new Error('provider lookup incomplete'));
    } else {
      mocks.provider.listCustomers.mockResolvedValue(customersPage({ offset: 0, hasMore: false, data: [] }));
    }

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });

    expect(mocks.provider.listCustomers).toHaveBeenCalledWith(expect.objectContaining({
      externalReference, offset: 0, limit: 100,
    }));
    expect(mocks.updateOrderMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ paymentStatus: 'PAYMENT_CREATION_UNKNOWN' }),
      data: { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }));
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'CRITICAL',
      remoteStatus: lookupResult === 'empty' ? 'CUSTOMER_CREATION_UNKNOWN_NO_MATCH' : 'CUSTOMER_REFERENCE_LOOKUP_INCOMPLETE',
      metadata: expect.objectContaining({ operation: 'CUSTOMER_CREATION', customerCreationPostStarted: true }),
    }));
    expect(mocks.provider.createCustomer).not.toHaveBeenCalled();
    expect(mocks.provider.createPayment).not.toHaveBeenCalled();
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

  it('permite uma tentativa única em UNKNOWN legado sem customer quando a busca completa é vazia', async () => {
    mocks.prepare.mockResolvedValue({
      ...pending(),
      order: { ...pending().order, paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    });
    mocks.findOrder.mockReset();
    mocks.provider.listPayments.mockResolvedValueOnce(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.createPayment.mockResolvedValue({
      id: 'pay-proven-pre-post', customer: 'cus-1', value: 20, billingType: 'PIX',
      externalReference, status: 'PENDING',
    });
    mocks.findOrder.mockResolvedValueOnce({ ...pending().order, asaasPaymentId: 'pay-proven-pre-post', items: [] });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .resolves.toMatchObject({ order: { asaasPaymentId: 'pay-proven-pre-post' } });

    expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);
    expect(mocks.provider.createCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.cancelOrder).not.toHaveBeenCalled();
  });

  it('does not issue a second POST after accepted/lost response and a temporarily empty lookup', async () => {
    mocks.prepare.mockResolvedValueOnce(pending()).mockResolvedValueOnce({
      ...pending(), order: { ...pending().order, paymentStatus: 'PAYMENT_CREATION_UNKNOWN', asaasCustomerId: 'cus-1' },
    });
    mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
    const acceptedRemotely: Array<Record<string, unknown>> = [];
    mocks.provider.createPayment.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      acceptedRemotely.push({ id: 'pay-accepted-but-not-yet-visible', ...data });
      throw new Error('response lost after provider accepted request');
    });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput())).rejects.toThrow('response lost');
    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });

    expect(mocks.provider.listPayments).toHaveBeenCalledTimes(3);
    expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);
    expect(acceptedRemotely).toHaveLength(1);
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({ remoteStatus: 'PAYMENT_CREATION_UNKNOWN_NO_MATCH' }));
  });

  it('recovers an accepted customer by exact order reference after a lost response and empty CPF lookup', async () => {
    const customer = {
      id: 'cus-created-before-lost-response', cpfCnpj: '12345678901',
      externalReference, deleted: false,
    };
    mocks.prepare.mockResolvedValueOnce(pending()).mockResolvedValueOnce({
      ...pending(), order: { ...pending().order, paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }).mockResolvedValueOnce({
      ...pending(), order: { ...pending().order, asaasCustomerId: customer.id, paymentStatus: null },
    });
    mocks.findIssueForOrder.mockResolvedValue({
      metadata: { operation: 'CUSTOMER_CREATION', customerCreationPostStarted: true, customerCreationPostStartedAt: new Date().toISOString(), externalReference },
      detectedAt: new Date(),
    });
    mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.listCustomers
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: false, data: [] }))
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: false, data: [customer] }))
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: false, data: [customer] }));
    mocks.provider.createCustomer.mockRejectedValueOnce(new Error('response lost after provider accepted customer'));
    mocks.provider.createPayment.mockResolvedValue({
      id: 'pay-after-customer-recovery', customer: customer.id, value: 20, billingType: 'PIX',
      externalReference, status: 'PENDING',
    });
    mocks.findOrder.mockReset()
      .mockResolvedValueOnce({
      ...pending().order, asaasPaymentId: null, paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
      items: [], buyerEmail: 'buyer@example.test', buyerName: 'Buyer', accessToken: 'token', invoiceUrl: null,
      })
      .mockResolvedValueOnce({
        ...pending().order, asaasPaymentId: null, asaasCustomerId: customer.id,
        paymentStatus: null, items: [], buyerEmail: 'buyer@example.test', buyerName: 'Buyer', accessToken: 'token', invoiceUrl: null,
      })
      .mockResolvedValueOnce({
        ...pending().order, asaasPaymentId: 'pay-after-customer-recovery', items: [],
        buyerEmail: 'buyer@example.test', buyerName: 'Buyer', accessToken: 'token', invoiceUrl: null,
      });

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COMPRADOR_EM_RECONCILIACAO' });
    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });
    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .resolves.toMatchObject({ order: { asaasPaymentId: 'pay-after-customer-recovery' } });

    expect(mocks.provider.createCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.provider.listCustomers).toHaveBeenNthCalledWith(2, expect.objectContaining({
      externalReference, offset: 0, limit: 100,
    }));
    expect(mocks.findIssueForOrder).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-A', entityType: 'PAYMENT', entityId: 'order-1',
        issueType: 'BILLING_OPERATION_UNCERTAIN',
      },
      select: { metadata: true },
    }));
    expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);
    expect(mocks.resolveCustomerIssue).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'conta-A',
        dedupeKey: 'BILLING_OPERATION_UNCERTAIN:PAYMENT:order-1',
        status: 'OPEN',
        AND: expect.arrayContaining([
          { metadata: { path: ['operation'], equals: 'CUSTOMER_CREATION' } },
          { metadata: { path: ['externalReference'], equals: externalReference } },
        ]),
      }),
      data: expect.objectContaining({ status: 'RESOLVED' }),
    }));
  });

  it('reopens customer issue as payment issue after a later ambiguous payment POST', async () => {
    const customer = { id: 'cus-recovered-for-payment', cpfCnpj: '12345678901', externalReference, deleted: false };
    const customerMarker = {
      operation: 'CUSTOMER_CREATION', customerCreationPostStarted: true,
      customerCreationPostStartedAt: new Date().toISOString(), externalReference,
    };
    mocks.prepare.mockResolvedValueOnce(pending()).mockResolvedValueOnce({
      ...pending(), order: { ...pending().order, paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
    }).mockResolvedValueOnce({
      ...pending(), order: { ...pending().order, asaasCustomerId: customer.id, paymentStatus: null },
    });
    mocks.findIssueForOrder.mockResolvedValue({ metadata: customerMarker, detectedAt: new Date() });
    mocks.findOrder.mockReset().mockResolvedValue({
      asaasPaymentId: null, paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
    });
    mocks.provider.listPayments.mockResolvedValue(page({ offset: 0, hasMore: false, data: [] }));
    mocks.provider.listCustomers
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: false, data: [] }))
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: false, data: [customer] }))
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: false, data: [customer] }));
    mocks.provider.createCustomer.mockRejectedValueOnce(new Error('response lost after provider accepted customer'));
    mocks.provider.createPayment.mockRejectedValueOnce(new Error('response lost after provider accepted payment'));

    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'COMPRADOR_EM_RECONCILIACAO' });
    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toMatchObject({ code: 'PAGAMENTO_EM_VERIFICACAO' });
    await expect(completePublicEventMapCheckout('public-map', checkoutInput()))
      .rejects.toThrow('response lost after provider accepted payment');

    const paymentIssue = mocks.upsertIssue.mock.calls.at(-1)?.[0];
    expect(paymentIssue).toMatchObject({
      contaId: 'conta-A',
      entityId: 'order-1',
      remoteStatus: 'POST_RESPONSE_PAYMENT_NOT_FOUND',
      metadata: {
        operation: 'PAYMENT_CREATION',
        customerCreationPostStarted: false,
        previousCustomerCreationAttempt: {
          postStarted: true,
          externalReference,
          resolvedBeforePayment: true,
        },
      },
    });
    expect(paymentIssue.metadata).not.toHaveProperty('customerCreationPostStarted', true);
    expect(mocks.provider.createCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.provider.createPayment).toHaveBeenCalledTimes(1);
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
      where: expect.objectContaining({ paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' }),
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
      where: expect.objectContaining({ paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' }),
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
