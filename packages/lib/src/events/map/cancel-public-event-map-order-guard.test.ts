import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, prismaMock } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    eventMapOrder: { findFirst: vi.fn(), update: vi.fn() },
    eventMapPublicSeat: { updateMany: vi.fn() },
    eventMapReservation: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    prismaMock: { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) },
  };
});

vi.mock('../../prisma', () => ({ prisma: prismaMock }));

import { cancelPublicEventMapOrder } from './event-map-order-operations';

describe('cancelPublicEventMapOrder expected payment state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tx.eventMapOrder.findFirst
      .mockResolvedValueOnce({ reservationId: null })
      // Represents a payment restored/settled after finance's initial DELETED
      // check but before this transaction acquired the order row lock.
      .mockResolvedValueOnce({
        id: 'order-1', contaId: 'tenant-1', status: 'PAYMENT_PENDING', paymentStatus: 'RECEIVED',
        reservationId: null, reservation: null,
      });
    tx.$queryRaw.mockResolvedValue([{ id: 'order-1' }]);
  });

  it('refuses cancellation if the payment state changed before the locked reread', async () => {
    await expect(cancelPublicEventMapOrder(
      'tenant-1', 'order-1', 'ASAAS_PAYMENT_ALREADY_DELETED', { expectedPaymentStatus: 'DELETED' },
    )).resolves.toEqual({ ok: false });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].strings.join('')).toContain('FOR UPDATE');
    expect(tx.eventMapPublicSeat.updateMany).not.toHaveBeenCalled();
    expect(tx.eventMapReservation.updateMany).not.toHaveBeenCalled();
    expect(tx.eventMapOrder.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
