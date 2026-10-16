import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    eventMapOrder: { findFirst: vi.fn(), updateMany: vi.fn() },
    eventTicket: { updateMany: vi.fn() },
    eventMapPublicSeat: { updateMany: vi.fn() },
    eventTicketSale: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    eventTicketLot: { findFirst: vi.fn(), update: vi.fn() },
    eventFinancialEntry: { updateMany: vi.fn() },
  },
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('./events-finance-observability', () => ({ logEventsFinance: vi.fn() }));

import { refundPublicEventMapOrderByPayment } from './event-map-payment-transitions';
import { logEventsFinance } from './events-finance-observability';

describe('refundPublicEventMapOrderByPayment finality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1' })
      .mockResolvedValueOnce({
        id: 'order-1', contaId: 'conta-1', status: 'CONFIRMED', paymentStatus: 'RECEIVED', totalAmount: 60,
        items: [{ publicSeatId: 'seat-1', ticket: { status: 'VALID' } }],
      });
    prismaMock.eventTicket.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.eventMapPublicSeat.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.eventTicketSale.findMany.mockResolvedValue([]);
    prismaMock.eventTicketSale.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    prismaMock.eventMapOrder.updateMany.mockResolvedValue({ count: 1 });
  });

  it('serializa a finalização do estorno no lock do pedido antes de cancelar ingresso e liberar assento', async () => {
    const result = await refundPublicEventMapOrderByPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', externalReference: null,
    });

    expect(result).toEqual({ orderId: 'order-1', status: 'REFUNDED' });
    const lockOrder = prismaMock.$queryRaw.mock.invocationCallOrder[0];
    const rereadOrder = prismaMock.eventMapOrder.findFirst.mock.invocationCallOrder[1];
    const cancelTickets = prismaMock.eventTicket.updateMany.mock.invocationCallOrder[0];
    const releaseSeats = prismaMock.eventMapPublicSeat.updateMany.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(rereadOrder);
    expect(rereadOrder).toBeLessThan(cancelTickets);
    expect(cancelTickets).toBeLessThan(releaseSeats);
    expect(prismaMock.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
  });

  it('mantém idempotência quando o pedido já foi finalizado como estornado', async () => {
    prismaMock.eventMapOrder.findFirst.mockReset();
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1' })
      .mockResolvedValueOnce({ id: 'order-1', status: 'REFUNDED', paymentStatus: 'REFUNDED' });

    const result = await refundPublicEventMapOrderByPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', externalReference: null,
    });

    expect(result).toEqual({ orderId: 'order-1', status: 'REFUNDED' });
    expect(prismaMock.eventTicket.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.eventMapPublicSeat.updateMany).not.toHaveBeenCalled();
  });

  it('preserva o reembolso cumulativo diante de snapshot parcial antigo, duplicata e finalização', async () => {
    const order = {
      id: 'order-1', contaId: 'conta-1', status: 'CONFIRMED', paymentStatus: 'RECEIVED',
      totalAmount: 100, refundedAmount: 0,
      items: [{ publicSeatId: 'seat-1', ticket: { status: 'VALID' } }],
    };
    const sale = { id: 'sale-1', contaId: 'conta-1', lotId: 'lot-1', totalAmount: 100, refundedAmount: 0 };
    prismaMock.eventMapOrder.findFirst.mockReset().mockImplementation(async ({ select }: { select?: unknown }) => {
      if (select) return { id: order.id, reservationId: null, asaasPaymentId: 'pay-1' };
      return { ...order, items: order.items };
    });
    prismaMock.eventTicketSale.findMany.mockImplementation(async () => [{ ...sale }]);
    prismaMock.eventTicketSale.update.mockImplementation(async ({ data }: { data: Partial<typeof sale> }) => {
      Object.assign(sale, data);
      return sale;
    });
    prismaMock.eventMapOrder.updateMany.mockImplementation(async ({ data }: { data: Partial<typeof order> }) => {
      Object.assign(order, data);
      return { count: 1 };
    });

    const refund = (refundedAmount: number, partial = true) => refundPublicEventMapOrderByPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', refundedAmount, partial,
    });

    expect(await refund(40)).toEqual({ orderId: 'order-1', status: 'PARTIALLY_REFUNDED' });
    expect(Number(sale.refundedAmount)).toBe(40);
    expect(Number(order.refundedAmount)).toBe(40);

    expect(await refund(15)).toEqual({ orderId: 'order-1', status: 'PARTIALLY_REFUNDED' });
    expect(Number(sale.refundedAmount)).toBe(40);
    expect(Number(order.refundedAmount)).toBe(40);

    expect(await refund(15)).toEqual({ orderId: 'order-1', status: 'PARTIALLY_REFUNDED' });
    expect(Number(sale.refundedAmount)).toBe(40);
    expect(Number(order.refundedAmount)).toBe(40);

    expect(await refund(60, false)).toEqual({ orderId: 'order-1', status: 'REFUNDED' });
    expect(Number(order.refundedAmount)).toBe(100);
    expect(Number(sale.refundedAmount)).toBe(100);
    expect(prismaMock.eventTicket.updateMany).toHaveBeenCalled();
    expect(prismaMock.eventMapPublicSeat.updateMany).toHaveBeenCalled();
  });

  it('aloca reembolsos cumulativos entre várias vendas em ordem estável', async () => {
    const order = {
      id: 'order-1', contaId: 'conta-1', status: 'CONFIRMED', paymentStatus: 'RECEIVED',
      totalAmount: 100, refundedAmount: 0,
      items: [{ publicSeatId: 'seat-1', ticket: { status: 'VALID' } }],
    };
    const sales = [
      { id: 'sale-b', contaId: 'conta-1', lotId: 'lot-2', totalAmount: 60, refundedAmount: 0, status: 'PAID' },
      { id: 'sale-a', contaId: 'conta-1', lotId: 'lot-1', totalAmount: 40, refundedAmount: 0, status: 'PAID' },
    ];
    prismaMock.eventMapOrder.findFirst.mockReset().mockImplementation(async ({ select }: { select?: unknown }) => {
      if (select) return { id: order.id, reservationId: null, asaasPaymentId: 'pay-1' };
      return { ...order, items: order.items };
    });
    prismaMock.eventTicketSale.findMany.mockImplementation(async (args: { orderBy?: { id?: 'asc' | 'desc' } }) =>
      [...sales].sort((left, right) => args.orderBy?.id === 'asc'
        ? left.id.localeCompare(right.id)
        : right.id.localeCompare(left.id)));
    prismaMock.eventTicketSale.update.mockImplementation(async ({ where, data }: {
      where: { id: string };
      data: Partial<(typeof sales)[number]>;
    }) => {
      const sale = sales.find((candidate) => candidate.id === where.id)!;
      Object.assign(sale, data);
      return sale;
    });
    prismaMock.eventMapOrder.updateMany.mockImplementation(async ({ data }: { data: Partial<typeof order> }) => {
      Object.assign(order, data);
      return { count: 1 };
    });

    const refund = (refundedAmount: number) => refundPublicEventMapOrderByPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', refundedAmount, partial: true,
    });

    expect(await refund(45)).toEqual({ orderId: 'order-1', status: 'PARTIALLY_REFUNDED' });
    expect(sales.map(({ id, refundedAmount }) => [id, Number(refundedAmount)])).toEqual([['sale-b', 5], ['sale-a', 40]]);
    expect(prismaMock.eventTicketSale.findMany.mock.calls[0][0]).toMatchObject({ orderBy: { id: 'asc' } });

    expect(await refund(70)).toEqual({ orderId: 'order-1', status: 'PARTIALLY_REFUNDED' });
    expect(sales.map(({ id, refundedAmount }) => [id, Number(refundedAmount)])).toEqual([['sale-b', 30], ['sale-a', 40]]);

    expect(await refund(55)).toEqual({ orderId: 'order-1', status: 'PARTIALLY_REFUNDED' });
    expect(sales.map(({ id, refundedAmount }) => [id, Number(refundedAmount)])).toEqual([['sale-b', 30], ['sale-a', 40]]);
  });

  it('preserva estorno legado acima do bruto e registra alerta no parcial e no final', async () => {
    const order = {
      id: 'order-1', contaId: 'conta-1', status: 'CONFIRMED', paymentStatus: 'RECEIVED',
      totalAmount: 100, refundedAmount: 120,
      items: [{ publicSeatId: 'seat-1', ticket: { status: 'VALID' } }],
    };
    const sale = {
      id: 'sale-1', contaId: 'conta-1', eventMapOrderId: 'order-1', lotId: 'lot-1',
      totalAmount: 50, refundedAmount: 60, status: 'PAID',
    };
    prismaMock.eventMapOrder.findFirst.mockReset().mockImplementation(async ({ select }: { select?: unknown }) => {
      if (select) return { id: order.id, reservationId: null, asaasPaymentId: 'pay-1' };
      return { ...order, items: order.items };
    });
    prismaMock.eventTicketSale.findMany.mockResolvedValue([sale]);
    prismaMock.eventTicketSale.update.mockImplementation(async ({ data }: { data: Partial<typeof sale> }) => {
      Object.assign(sale, data);
      return sale;
    });
    prismaMock.eventMapOrder.updateMany.mockImplementation(async ({ data }: { data: Partial<typeof order> }) => {
      Object.assign(order, data);
      return { count: 1 };
    });

    const partial = await refundPublicEventMapOrderByPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', refundedAmount: 70, partial: true,
    });
    expect(partial).toEqual({ orderId: 'order-1', status: 'PARTIALLY_REFUNDED' });
    expect(Number(sale.refundedAmount)).toBe(60);
    expect(Number(order.refundedAmount)).toBe(120);
    expect(prismaMock.eventTicketSale.update.mock.calls[0][0].where).toEqual({
      id: 'sale-1', contaId: 'conta-1', eventMapOrderId: 'order-1',
    });

    const final = await refundPublicEventMapOrderByPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', partial: false,
    });
    expect(final).toEqual({ orderId: 'order-1', status: 'REFUNDED' });
    expect(Number(sale.refundedAmount)).toBe(60);
    expect(Number(order.refundedAmount)).toBe(120);
    expect(logEventsFinance).toHaveBeenCalledWith(
      'finance.events.ticket_sale.refund_amount_over_gross', { errors: 2 }, 'warn',
    );
    expect(prismaMock.eventTicketSale.update.mock.calls[1][0].where).toEqual({
      id: 'sale-1', contaId: 'conta-1', eventMapOrderId: 'order-1',
    });
  });

  it('preserva hold do pedido e não marca como estornada uma venda sem alocação', async () => {
    const order = {
      id: 'order-1', contaId: 'conta-1', status: 'CONFIRMED', paymentStatus: 'REFUND_IN_PROGRESS',
      totalAmount: 100, refundedAmount: 0,
      items: [{ publicSeatId: 'seat-1', ticket: { status: 'VALID' } }],
    };
    const sales = [
      { id: 'sale-a', contaId: 'conta-1', eventMapOrderId: 'order-1', lotId: 'lot-a', totalAmount: 10, refundedAmount: 0, status: 'PAID', paymentStatus: 'RECEIVED' },
      { id: 'sale-b', contaId: 'conta-1', eventMapOrderId: 'order-1', lotId: 'lot-b', totalAmount: 90, refundedAmount: 0, status: 'PAID', paymentStatus: 'RECEIVED' },
    ];
    prismaMock.eventMapOrder.findFirst.mockReset().mockImplementation(async ({ select }: { select?: unknown }) => {
      if (select) return { id: order.id, reservationId: null, asaasPaymentId: 'pay-1' };
      return { ...order, items: order.items };
    });
    prismaMock.eventTicketSale.findMany.mockResolvedValue(sales);
    prismaMock.eventTicketSale.update.mockImplementation(async ({ where, data }: {
      where: { id: string };
      data: Partial<(typeof sales)[number]>;
    }) => {
      const sale = sales.find((candidate) => candidate.id === where.id)!;
      Object.assign(sale, data);
      return sale;
    });
    prismaMock.eventMapOrder.updateMany.mockImplementation(async ({ data }: { data: Partial<typeof order> }) => {
      Object.assign(order, data);
      return { count: 1 };
    });

    const result = await refundPublicEventMapOrderByPayment({
      contaId: 'conta-1', asaasPaymentId: 'pay-1', refundedAmount: 5, partial: true,
    });

    expect(result).toEqual({ orderId: 'order-1', status: 'PARTIALLY_REFUNDED' });
    expect(prismaMock.eventMapOrder.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'CONFIRMED', paymentStatus: 'REFUND_IN_PROGRESS',
    });
    expect(sales.map(({ status, paymentStatus, refundedAmount }) => ({ status, paymentStatus, refundedAmount: Number(refundedAmount) }))).toEqual([
      { status: 'PAID', paymentStatus: 'REFUND_IN_PROGRESS', refundedAmount: 5 },
      { status: 'PAID', paymentStatus: 'RECEIVED', refundedAmount: 0 },
    ]);
    expect(prismaMock.eventFinancialEntry.updateMany.mock.calls[1][0].data).not.toHaveProperty('status');
    expect(prismaMock.eventFinancialEntry.updateMany.mock.calls[1][0].data.paymentStatus).toBe('RECEIVED');
  });

  it('não altera pedido nem vendas quando o pagamento não pertence à conta informada', async () => {
    prismaMock.eventMapOrder.findFirst.mockReset().mockResolvedValue(null);

    const result = await refundPublicEventMapOrderByPayment({
      contaId: 'conta-estranha', asaasPaymentId: 'pay-1', refundedAmount: 40, partial: true,
    });

    expect(result).toBeNull();
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.eventTicketSale.findMany).not.toHaveBeenCalled();
    expect(prismaMock.eventTicketSale.update).not.toHaveBeenCalled();
    expect(prismaMock.eventFinancialEntry.updateMany).not.toHaveBeenCalled();
  });
});
