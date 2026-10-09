import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    eventMapOrder: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('../../../lib/src/prisma', () => ({ prisma: prismaMock }));

import { confirmPublicEventMapOrderPayment } from './confirm-public-event-map-order-payment';
import { reconcileEventMapOrderFinancialStateFromAsaas } from './event-map-payment-transitions';

describe('event map payment confirmation lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1' })
      // Represents a chargeback hold committed after the webhook pre-read,
      // but before this transaction acquired the order lock.
      .mockResolvedValueOnce({
        id: 'order-1', contaId: 'conta-1', status: 'PAYMENT_PENDING', paymentStatus: 'CHARGEBACK_UNKNOWN',
      });
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
    const lockedReread = prismaMock.eventMapOrder.findFirst.mock.invocationCallOrder[1];
    expect(lockOrder).toBeLessThan(lockedReread);
    expect(prismaMock.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(prismaMock.$queryRaw.mock.calls[0][2]).toContain('conta-1');
    expect(prismaMock.eventMapOrder.updateMany).not.toHaveBeenCalled();
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
});
