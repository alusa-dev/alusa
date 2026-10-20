import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    eventMapOrder: { findFirst: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    financeWebhookSideEffectOutbox: { createMany: vi.fn() },
  },
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('../../../lib/src/prisma', () => ({ prisma: prismaMock }));

import { confirmPublicEventMapOrderPayment } from './confirm-public-event-map-order-payment';
import { reconcileEventMapOrderFinancialStateFromAsaas } from './event-map-payment-transitions';

const validOrderGraph = (overrides: Record<string, unknown> = {}) => ({
  id: 'order-1', contaId: 'conta-1', eventId: 'event-1', eventMapId: 'map-1', versionId: 'version-1',
  reservationId: null, asaasPaymentId: 'pay-1', status: 'PAYMENT_PENDING', paymentStatus: 'PENDING',
  totalAmount: 60, confirmedAt: null, ticketFulfillmentStatus: 'PENDING',
  map: { id: 'map-1', contaId: 'conta-1', eventId: 'event-1', publishedVersionId: 'version-1' },
  version: { contaId: 'conta-1', eventMapId: 'map-1', snapshot: {} },
  event: { id: 'event-1', contaId: 'conta-1' }, reservation: null, items: [],
  ...overrides,
});

describe('event map payment confirmation lock', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      // Represents a chargeback hold committed after the webhook pre-read,
      // but before this transaction acquired the order lock.
      .mockResolvedValueOnce(validOrderGraph({ paymentStatus: 'CHARGEBACK_UNKNOWN' }));
  });

  it('locks and rereads the tenant order before rejecting stale paid confirmation', async () => {
    await expect(confirmPublicEventMapOrderPayment({
      contaId: 'conta-1',
      asaasPaymentId: 'pay-1',
      externalReference: 'event-map-order:order-1',
      paymentStatus: 'RECEIVED',
      paidAmount: 60,
      allowReleasedReservation: true,
    })).rejects.toMatchObject({ code: 'PAGAMENTO_BLOQUEADO_POR_ANALISE' });

    const lockOrder = prismaMock.$queryRaw.mock.invocationCallOrder[0];
    const lockedReread = prismaMock.eventMapOrder.findFirst.mock.invocationCallOrder[2];
    expect(lockOrder).toBeLessThan(lockedReread);
    expect(prismaMock.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(prismaMock.$queryRaw.mock.calls[0][2]).toContain('conta-1');
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
  });

  it.each(['DELETED', 'CANCELLATION_IN_PROGRESS'] as const)('rejects confirmation when the locked order has payment status %s', async (paymentStatus) => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce(validOrderGraph({ paymentStatus }));

    await expect(confirmPublicEventMapOrderPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', paymentStatus: 'RECEIVED', paidAmount: 60,
    })).rejects.toMatchObject({ code: 'PAGAMENTO_BLOQUEADO_POR_ANALISE' });
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.financeWebhookSideEffectOutbox.createMany).not.toHaveBeenCalled();
  });

  it('rejects a paid confirmation after DELETE committed between provider lookup and confirmation', async () => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      // This locked read observes the PAYMENT_DELETED webhook that committed
      // after the finalizer's remote GET and before ticket confirmation.
      .mockResolvedValueOnce(validOrderGraph({ paymentStatus: 'DELETED' }));

    await expect(confirmPublicEventMapOrderPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', paymentStatus: 'RECEIVED', paidAmount: 60,
    })).rejects.toMatchObject({ code: 'PAGAMENTO_BLOQUEADO_POR_ANALISE' });
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.financeWebhookSideEffectOutbox.createMany).not.toHaveBeenCalled();
  });

  it('treats a blocked paid reconciliation as handled without mutating or retrying the order', async () => {
    const result = await reconcileEventMapOrderFinancialStateFromAsaas({
      contaId: 'conta-1',
      asaasPaymentId: 'pay-1',
      externalReference: 'event-map-order:order-1',
      paymentStatus: 'RECEIVED',
    });

    expect(result).toEqual({ orderId: 'order-1', status: 'PAYMENT_PENDING', financialOnly: true, blocked: true });
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
  });

  it.each(['DELETED', 'CANCELLATION_IN_PROGRESS'] as const)(
    'fails closed when a paid reconciliation reads terminal payment status %s under the order lock',
    async (paymentStatus) => {
      vi.resetAllMocks();
      prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
      prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
      prismaMock.eventMapOrder.findFirst
        .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
        .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
        // Models PAYMENT_DELETED committing after provider GET but before the
        // fallback financial reconciliation obtains the order row lock.
        .mockResolvedValueOnce(validOrderGraph({ status: 'EXPIRED', paymentStatus }));

      await expect(reconcileEventMapOrderFinancialStateFromAsaas({
        contaId: 'conta-1',
        asaasPaymentId: 'pay-1',
        externalReference: 'event-map-order:order-1',
        paymentStatus: 'RECEIVED',
        paidAmount: 60,
      })).resolves.toEqual({ orderId: 'order-1', status: 'EXPIRED', financialOnly: true, blocked: true });

      expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
      expect(prismaMock.financeWebhookSideEffectOutbox.createMany).not.toHaveBeenCalled();
    },
  );

  it('preserves an Asaas date-only paidAt when persisting reconciled order dates', async () => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce(validOrderGraph());
    prismaMock.eventMapOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auditLog.create.mockResolvedValue({});

    await reconcileEventMapOrderFinancialStateFromAsaas({
      contaId: 'conta-1',
      asaasPaymentId: 'pay-1',
      externalReference: 'event-map-order:order-1',
      paymentStatus: 'RECEIVED',
      paidAt: '2026-03-27',
    });

    expect(prismaMock.eventMapOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paidAt: new Date('2026-03-27T00:00:00.000Z'),
        confirmedAt: new Date('2026-03-27T00:00:00.000Z'),
      }),
    }));
  });

  it('preserves Date inputs and rejects invalid paidAt values before opening a transaction', async () => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', contaId: 'conta-1', status: 'PAYMENT_PENDING', asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce(validOrderGraph());
    prismaMock.eventMapOrder.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auditLog.create.mockResolvedValue({});
    const paidAt = new Date('2026-03-27T14:15:00.000Z');
    const result = await reconcileEventMapOrderFinancialStateFromAsaas({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', paymentStatus: 'RECEIVED', paidAt,
    });
    expect(result).toEqual({ orderId: 'order-1', status: 'CONFIRMED', financialOnly: true });
    expect(prismaMock.eventMapOrder.updateMany.mock.calls[0][0].data.paidAt).toBe(paidAt);

    vi.resetAllMocks();
    await expect(reconcileEventMapOrderFinancialStateFromAsaas({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', paymentStatus: 'RECEIVED', paidAt: 'invalid',
    })).resolves.toBeNull();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    await expect(reconcileEventMapOrderFinancialStateFromAsaas({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', paymentStatus: 'RECEIVED', paidAt: '2026-02-30',
    })).rejects.toThrow(RangeError);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('fails closed before writes when the included map belongs to another tenant', async () => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce(validOrderGraph({ paymentStatus: 'PENDING', map: { id: 'map-1', contaId: 'conta-other', eventId: 'event-1', publishedVersionId: 'version-1' } }));

    await expect(confirmPublicEventMapOrderPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', paymentStatus: 'RECEIVED', paidAmount: 60,
    })).rejects.toMatchObject({ code: 'RESERVA_INVALIDA' });
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not reconcile a paid snapshot when its order graph crosses tenants', async () => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce(validOrderGraph({ map: { id: 'map-1', contaId: 'conta-other', eventId: 'event-1', publishedVersionId: 'version-1' } }));

    await expect(reconcileEventMapOrderFinancialStateFromAsaas({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', paymentStatus: 'RECEIVED',
    })).resolves.toBeNull();
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not confirm when an order item is not tied to its tenant reservation seats', async () => {
    vi.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', reservationId: null, asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce(validOrderGraph({
        reservationId: 'reservation-1',
        reservation: { id: 'reservation-1', contaId: 'conta-1', eventId: 'event-1', eventMapId: 'map-1', versionId: 'version-1', seats: [] },
        items: [{ id: 'item-1', contaId: 'conta-1', orderId: 'order-1', publicSeatId: 'seat-other', publicSeat: { contaId: 'conta-1', eventId: 'event-1', eventMapId: 'map-1', versionId: 'version-1' }, ticket: null }],
      }));

    await expect(confirmPublicEventMapOrderPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', paymentStatus: 'RECEIVED', paidAmount: 60,
    })).rejects.toMatchObject({ code: 'RESERVA_INVALIDA' });
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
