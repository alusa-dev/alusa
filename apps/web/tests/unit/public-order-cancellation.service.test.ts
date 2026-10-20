import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst, runWithTenant, deletePayment, handlePaymentWebhook, finalizeDeletedPublicEventMapOrder } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  runWithTenant: vi.fn(async (_contaId: string, callback: (_tx: unknown) => Promise<unknown>) => callback({ eventMapOrder: { findFirst } })),
  deletePayment: vi.fn(),
  handlePaymentWebhook: vi.fn(),
  finalizeDeletedPublicEventMapOrder: vi.fn(),
}));

vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant }));
vi.mock('@alusa/finance', () => ({ deletePayment, handlePaymentWebhook, finalizeDeletedPublicEventMapOrder }));

import { cancelPendingPublicOrder } from '@/src/server/events/public-order-cancellation.service';

describe('cancelPendingPublicOrder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('looks up the order in the authenticated tenant and cancels through the payment webhook', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'order-1', status: 'PAYMENT_PENDING', paymentStatus: 'PENDING', asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce({ status: 'CANCELLED' });
    deletePayment.mockResolvedValue({ id: 'pay-1', deleted: true });
    handlePaymentWebhook.mockResolvedValue({ success: true });

    await expect(cancelPendingPublicOrder({ orderId: 'order-1', contaId: 'tenant-1' })).resolves.toBe('CANCELLED');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'order-1', contaId: 'tenant-1' } }));
    expect(runWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(deletePayment).toHaveBeenCalledWith('pay-1', { contaId: 'tenant-1' });
    expect(handlePaymentWebhook).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ event: 'PAYMENT_DELETED' }));
  });

  it.each([
    { status: 'PAYMENT_PENDING', paymentStatus: 'PAYMENT_CREATION_UNKNOWN', asaasPaymentId: 'pay-1' },
    { status: 'PAYMENT_PENDING', paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS', asaasPaymentId: 'pay-1' },
    { status: 'PAYMENT_PENDING', paymentStatus: 'RECEIVED', asaasPaymentId: 'pay-1' },
    { status: 'PAYMENT_PENDING', paymentStatus: 'PENDING', asaasPaymentId: null },
  ])('does not cancel an uncertain, non-pending, or unlinked order: %s', async (order) => {
    findFirst.mockResolvedValue(order);
    await expect(cancelPendingPublicOrder({ orderId: 'order-1', contaId: 'tenant-1' })).resolves.toBe('NOT_CANCELLABLE');
    expect(deletePayment).not.toHaveBeenCalled();
    expect(handlePaymentWebhook).not.toHaveBeenCalled();
  });

  it('allows a verified overdue payment to be deleted through the canonical webhook handler', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'order-1', status: 'PAYMENT_PENDING', paymentStatus: 'OVERDUE', asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce({ status: 'CANCELLED' });
    deletePayment.mockResolvedValue({ id: 'pay-1', deleted: true });
    handlePaymentWebhook.mockResolvedValue({ success: true });

    await expect(cancelPendingPublicOrder({ orderId: 'order-1', contaId: 'tenant-1' })).resolves.toBe('CANCELLED');
    expect(deletePayment).toHaveBeenCalledWith('pay-1', { contaId: 'tenant-1' });
    expect(handlePaymentWebhook).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ event: 'PAYMENT_DELETED' }));
  });

  it('finalizes an already-deleted pending payment without another provider DELETE', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'order-1', status: 'PAYMENT_PENDING', paymentStatus: 'DELETED', asaasPaymentId: 'pay-1' })
      .mockResolvedValueOnce({ status: 'CANCELLED' });
    finalizeDeletedPublicEventMapOrder.mockResolvedValue({ ok: true });

    await expect(cancelPendingPublicOrder({ orderId: 'order-1', contaId: 'tenant-1' })).resolves.toBe('CANCELLED');

    expect(finalizeDeletedPublicEventMapOrder).toHaveBeenCalledWith({ contaId: 'tenant-1', orderId: 'order-1' });
    expect(deletePayment).not.toHaveBeenCalled();
    expect(handlePaymentWebhook).not.toHaveBeenCalled();
    expect(runWithTenant).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'order-1', contaId: 'tenant-1' },
      select: { status: true },
    }));
  });

  it.each([
    { status: 'CONFIRMED', paymentStatus: 'DELETED' },
    { status: 'PAYMENT_PENDING', paymentStatus: 'RECEIVED' },
    { status: 'PAYMENT_PENDING', paymentStatus: 'CONFIRMED' },
  ])('never cancels a confirmed or paid order: %s', async (order) => {
    findFirst.mockResolvedValue({ ...order, id: 'order-1', asaasPaymentId: 'pay-1' });

    await expect(cancelPendingPublicOrder({ orderId: 'order-1', contaId: 'tenant-1' })).resolves.toBe('NOT_CANCELLABLE');

    expect(finalizeDeletedPublicEventMapOrder).not.toHaveBeenCalled();
    expect(deletePayment).not.toHaveBeenCalled();
    expect(handlePaymentWebhook).not.toHaveBeenCalled();
  });

  it('blocks unknown payment states without calling the provider', async () => {
    findFirst.mockResolvedValue({ id: 'order-1', status: 'PAYMENT_PENDING', paymentStatus: 'UNKNOWN_PROVIDER_STATE', asaasPaymentId: 'pay-1' });
    await expect(cancelPendingPublicOrder({ orderId: 'order-1', contaId: 'tenant-1' })).resolves.toBe('NOT_CANCELLABLE');
    expect(deletePayment).not.toHaveBeenCalled();
    expect(handlePaymentWebhook).not.toHaveBeenCalled();
  });
});
