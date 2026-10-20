import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst, cancelOrder } = vi.hoisted(() => ({ findFirst: vi.fn(), cancelOrder: vi.fn() }));

vi.mock('@alusa/database', () => ({ prisma: { eventMapOrder: { findFirst } } }));
vi.mock('../../../lib/src/prisma', () => ({ prisma: { eventMapOrder: { findFirst } } }));
vi.mock('@alusa/lib/events/map/event-map-order-operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alusa/lib/events/map/event-map-order-operations')>()),
  cancelPublicEventMapOrder: cancelOrder,
}));

import { finalizeDeletedPublicEventMapOrder } from './event-map-payment-transitions';

describe('finalizeDeletedPublicEventMapOrder', () => {
  beforeEach(() => vi.resetAllMocks());

  it('scopes the finalization to the requested tenant and cannot cancel another tenant order', async () => {
    const tenantAOrder = { id: 'order-a', contaId: 'tenant-a' };
    findFirst.mockImplementation(async ({ where }) =>
      where.contaId === tenantAOrder.contaId && where.id === tenantAOrder.id ? { id: tenantAOrder.id } : null);

    await expect(finalizeDeletedPublicEventMapOrder({ contaId: 'tenant-b', orderId: 'order-a' })).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'order-a', contaId: 'tenant-b', status: 'PAYMENT_PENDING', paymentStatus: 'DELETED',
        asaasPaymentId: { not: null },
      },
      select: { id: true },
    });
    expect(cancelOrder).not.toHaveBeenCalled();

    findFirst.mockImplementation(async ({ where }) =>
      where.contaId === tenantAOrder.contaId && where.id === tenantAOrder.id ? { id: tenantAOrder.id } : null);
    cancelOrder.mockResolvedValue({ ok: true });
    await expect(finalizeDeletedPublicEventMapOrder({ contaId: 'tenant-a', orderId: 'order-a' }))
      .resolves.toEqual({ ok: true });
    expect(cancelOrder).toHaveBeenCalledWith('tenant-a', 'order-a', 'ASAAS_PAYMENT_ALREADY_DELETED', {
      expectedPaymentStatus: 'DELETED',
    });
  });
});
