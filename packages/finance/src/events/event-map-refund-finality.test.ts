import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    eventMapOrder: { findFirst: vi.fn(), updateMany: vi.fn() },
    eventTicket: { updateMany: vi.fn() },
    eventMapPublicSeat: { updateMany: vi.fn() },
    eventTicketSale: { findMany: vi.fn(), updateMany: vi.fn() },
    eventFinancialEntry: { updateMany: vi.fn() },
  },
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));

import { refundPublicEventMapOrderByPayment } from './event-map-payment-transitions';

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
});
