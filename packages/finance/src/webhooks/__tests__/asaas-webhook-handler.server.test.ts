import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  resourceOriginFindUnique: vi.fn(),
  payment: vi.fn(),
  confirmOutbound: vi.fn(),
  getQueueMetrics: vi.fn(),
  evaluateRetentionAlert: vi.fn(),
  markExhausted: vi.fn(),
}));

vi.mock('@alusa/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alusa/database')>()),
  prisma: {
    $transaction: mocks.transaction,
    webhookAsaas: {
      findMany: mocks.findMany,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
    asaasResourceOrigin: { findUnique: mocks.resourceOriginFindUnique },
  },
}));

vi.mock('../payment-webhook-handler', () => ({
  handlePaymentWebhook: mocks.payment,
}));

vi.mock('../../use-cases/outbound-financial-operation', () => ({
  confirmOutboundCreateByProviderEvent: mocks.confirmOutbound,
}));

vi.mock('../webhook-reconciliation.service', () => ({
  getWebhookQueueMetrics: mocks.getQueueMetrics,
  evaluateRetentionAlert: mocks.evaluateRetentionAlert,
  markExhaustedWebhooks: mocks.markExhausted,
}));

vi.mock('../webhook-observability.service', () => ({
  logWebhookProcessing: vi.fn(),
  createWebhookLogEntry: vi.fn((value) => value),
  logWebhookCompleted: vi.fn(),
  alertIfUnhandledCritical: vi.fn(),
  alertIfUnknownEvent: vi.fn(),
  alertTokenRejected: vi.fn(),
  alertQueueLagCritical: vi.fn(),
  logWebhookClaimed: vi.fn(),
}));

import { processAsaasWebhookQueue } from '../asaas-webhook-handler.server';

describe('processAsaasWebhookQueue notification timestamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const claimedAt = new Date('2026-03-28T15:02:00.000Z');
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: vi.fn().mockResolvedValue([{
        id: 'hook-1', tentativas: 2, ultimaTentativaEm: claimedAt,
      }]),
    }));
    mocks.findMany.mockResolvedValue([{
      id: 'hook-1',
      contaId: 'conta-a',
      status: 'PROCESSANDO',
      evento: 'PAYMENT_RECEIVED',
      eventId: 'evt-1',
      payload: {
        id: 'evt-1',
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: 'pay-1',
          clientPaymentDate: '2026-03-27',
          paymentDate: '2026-03-28 10:30:00',
          creditDate: '2026-03-29T12:00:00Z',
        },
      },
      recebidoEm: new Date('2026-03-28T15:00:00Z'),
      ultimaTentativaEm: claimedAt,
      tentativas: 2,
      attemptsLog: [],
    }]);
    mocks.update.mockResolvedValue({});
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.resourceOriginFindUnique.mockResolvedValue(null);
    mocks.payment.mockResolvedValue({ success: true, skipped: false });
    mocks.confirmOutbound.mockResolvedValue(undefined);
    mocks.getQueueMetrics.mockResolvedValue({});
    mocks.evaluateRetentionAlert.mockReturnValue(null);
  });

  it('chooses the first parseable instant and skips date-only candidates', async () => {
    const result = await processAsaasWebhookQueue({ contaId: 'conta-a', limit: 1 });

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.payment).toHaveBeenCalledOnce();
    expect(mocks.confirmOutbound).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ processed: 1, failed: 0 });
    expect(result.processedPayments).toEqual([expect.objectContaining({
      occurredAt: '2026-03-28T13:30:00.000Z',
    })]);
  });

  it('does not create a billing notification candidate for an ignored external panel payment', async () => {
    mocks.payment.mockResolvedValue({ success: true, skipped: true, skipReason: 'EXTERNAL_PAYMENT_IGNORED' });

    const result = await processAsaasWebhookQueue({ contaId: 'conta-a', limit: 1 });

    expect(result.processedPayments).toEqual([]);
  });
});
