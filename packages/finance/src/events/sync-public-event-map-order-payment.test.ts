import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOrder: vi.fn(),
  countAudit: vi.fn(),
  findLatestAudit: vi.fn(),
  createAudit: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  getStatus: vi.fn(),
  loadCredentials: vi.fn(),
  getPayment: vi.fn(),
}));

vi.mock('@alusa/database', () => ({ prisma: {
  eventMapOrder: { findFirst: mocks.findOrder },
  auditLog: { count: mocks.countAudit, findFirst: mocks.findLatestAudit, create: mocks.createAudit },
} }));
vi.mock('../foundation/webhook-job-lock.service', () => ({
  acquireWebhookJobLock: mocks.acquireLock,
  releaseWebhookJobLock: mocks.releaseLock,
}));
vi.mock('@alusa/lib/events/map/public-event-map-order-status.service', () => ({ getPublicEventMapOrderStatus: mocks.getStatus }));
vi.mock('../foundation/load-decrypted-asaas-credentials', () => ({ loadDecryptedAsaasCredentials: mocks.loadCredentials }));
vi.mock('./event-asaas-payment-provider', () => ({ getEventAsaasPaymentProvider: () => ({ getPayment: mocks.getPayment }) }));

import { syncPublicEventMapOrderPaymentByBuyer } from './sync-public-event-map-order-payment';

describe('syncPublicEventMapOrderPaymentByBuyer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOrder.mockResolvedValue({
      id: 'order-1', contaId: 'conta-1', status: 'PAYMENT_PENDING',
      ticketFulfillmentStatus: 'PENDING', asaasPaymentId: 'payment-1', accessToken: 'buyer-capability',
    });
    mocks.countAudit.mockResolvedValue(0);
    mocks.findLatestAudit.mockResolvedValue(null);
    mocks.createAudit.mockResolvedValue({});
    mocks.acquireLock.mockResolvedValue({ acquired: true, jobName: 'event-map-payment-sync:conta-1:order-1', workerId: 'worker-1' });
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.getStatus.mockResolvedValue({ orderId: 'order-1', status: 'PAYMENT_PENDING' });
    mocks.loadCredentials.mockResolvedValue({ apiKey: 'test-key' });
    mocks.getPayment.mockResolvedValue({ status: 'PENDING' });
  });

  it('reserves an automatic attempt before provider I/O and releases the durable lease', async () => {
    await syncPublicEventMapOrderPaymentByBuyer('order-1', 'buyer-capability', { automatic: true });

    expect(mocks.acquireLock).toHaveBeenCalledWith('event-map-payment-sync:conta-1:order-1', { ttlMs: 120_000 });
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'events.map.public.sync_payment_auto',
      entityId: 'order-1',
    }) }));
    expect(mocks.createAudit).toHaveBeenCalledTimes(1);
    expect(mocks.createAudit.mock.invocationCallOrder[0]).toBeLessThan(mocks.getPayment.mock.invocationCallOrder[0]);
    expect(mocks.releaseLock).toHaveBeenCalledWith({ jobName: 'event-map-payment-sync:conta-1:order-1', workerId: 'worker-1' });
  });

  it('does not call Asaas when another tab or instance owns the lease', async () => {
    mocks.acquireLock.mockResolvedValue({ acquired: false, jobName: 'event-map-payment-sync:conta-1:order-1', lockedUntil: new Date(), workerId: 'other' });

    const result = await syncPublicEventMapOrderPaymentByBuyer('order-1', 'buyer-capability', { automatic: true });

    expect(result).toMatchObject({ synced: false, throttled: true, status: 'PAYMENT_PENDING' });
    expect(mocks.getPayment).not.toHaveBeenCalled();
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  it('persists the automatic throttle reservation even when provider lookup fails', async () => {
    mocks.getPayment.mockRejectedValueOnce(new Error('temporary provider failure'));

    await expect(syncPublicEventMapOrderPaymentByBuyer('order-1', 'buyer-capability', { automatic: true })).rejects.toThrow('temporary provider failure');

    expect(mocks.createAudit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'events.map.public.sync_payment_auto' }) }));
    expect(mocks.releaseLock).toHaveBeenCalled();
  });
});
