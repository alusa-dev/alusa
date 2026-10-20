import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { eventMapOrder: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('../../../lib/src/prisma', () => ({ prisma: prismaMock }));

import { syncPublicEventMapOrderPaymentCreated } from './event-map-payment-transitions';

describe('public event map payment created CAS', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // The helper resolves both payment ID and external reference before the
    // final updateMany performs its state predicate against the current row.
    prismaMock.eventMapOrder.findFirst
      .mockResolvedValueOnce({ id: 'order-1', reservationId: 'reservation-1', asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce({ id: 'order-1', reservationId: 'reservation-1', asaasPaymentId: 'pay-1' });
  });

  it('does not let a stale PENDING snapshot overwrite a concurrently committed DELETED state', async () => {
    // findEventMapOrderForPayment sees the handler's stale pre-read, while the
    // updateMany mock applies its where predicate to the current committed row.
    const currentRow = { id: 'order-1', contaId: 'conta-1', status: 'CANCELLED', paymentStatus: 'DELETED' };
    prismaMock.eventMapOrder.updateMany.mockImplementation(async ({ where, data }) => {
      const allowedStatuses = where.status.in as string[];
      const paymentStateConditions = where.AND as Array<{ OR: Array<Record<string, unknown>> }>;
      const mayWriteCurrentStatus = allowedStatuses.includes(currentRow.status)
        && paymentStateConditions.every(({ OR }) => OR.some((condition) => {
          if ('paymentStatus' in condition && condition.paymentStatus === null) return currentRow.paymentStatus === null;
          const comparison = condition.paymentStatus as { not?: string; notIn?: string[] } | undefined;
          if (comparison?.not) return currentRow.paymentStatus !== comparison.not;
          if (comparison?.notIn) return !comparison.notIn.includes(currentRow.paymentStatus);
          return false;
        }));
      if (!mayWriteCurrentStatus) return { count: 0 };
      Object.assign(currentRow, data);
      return { count: 1 };
    });

    await expect(syncPublicEventMapOrderPaymentCreated({
      contaId: 'conta-1', asaasPaymentId: 'pay-1',
      externalReference: 'event-map-order:order-1', paymentStatus: 'PENDING',
    })).resolves.toBeNull();

    const where = prismaMock.eventMapOrder.updateMany.mock.calls[0][0].where;
    expect(where.contaId).toBe('conta-1');
    expect(where.status.in).not.toContain('CANCELLED');
    expect(where.AND).toContainEqual({ OR: [{ paymentStatus: null }, { paymentStatus: { not: 'DELETED' } }] });
    expect(where.AND).toContainEqual(expect.objectContaining({ OR: expect.any(Array) }));
    const currentPaymentGuard = where.AND.find((condition: { OR: Array<Record<string, unknown>> }) =>
      condition.OR.some((entry) => typeof entry.paymentStatus === 'object' && entry.paymentStatus !== null && 'notIn' in entry.paymentStatus));
    expect(currentPaymentGuard?.OR).toContainEqual({ paymentStatus: { notIn: expect.arrayContaining([
      'PAYMENT_REFUNDED', 'REFUND_DENIED', 'IN_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL', 'DISPUTE_LOST', 'CHARGEBACK', 'REQUESTED', 'DONE',
    ]) } });
    expect(currentRow.paymentStatus).toBe('DELETED');
  });

  it('still persists the explicit DELETED webhook after local order cancellation', async () => {
    prismaMock.eventMapOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(syncPublicEventMapOrderPaymentCreated({
      contaId: 'conta-1', asaasPaymentId: 'pay-1',
      externalReference: 'event-map-order:order-1', paymentStatus: 'DELETED',
    })).resolves.toEqual({ orderId: 'order-1', status: 'PAYMENT_PENDING' });

    const { where, data } = prismaMock.eventMapOrder.updateMany.mock.calls[0][0];
    expect(where.status.in).toContain('CANCELLED');
    expect(data.paymentStatus).toBe('DELETED');
  });
});
