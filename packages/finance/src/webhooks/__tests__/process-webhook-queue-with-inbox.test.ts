import { beforeEach, describe, expect, it, vi } from 'vitest';

const processQueue = vi.hoisted(() => vi.fn());
const enqueueSideEffects = vi.hoisted(() => vi.fn());
const drainSideEffects = vi.hoisted(() => vi.fn());
const reconcileSideEffects = vi.hoisted(() => vi.fn());

vi.mock('../asaas-webhook-handler.server', () => ({
  processAsaasWebhookQueue: processQueue,
}));

vi.mock('../finance-side-effect-outbox.service', () => ({
  enqueueBillingNotificationSideEffects: enqueueSideEffects,
  drainFinanceWebhookSideEffectOutbox: drainSideEffects,
  reconcileMissingBillingNotificationSideEffects: reconcileSideEffects,
}));

import { processAsaasWebhookQueueWithInbox } from '../process-webhook-queue-with-inbox';

describe('processAsaasWebhookQueueWithInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processQueue.mockResolvedValue({ processedPayments: [], processed: 0, failed: 0 });
    enqueueSideEffects.mockResolvedValue(undefined);
    drainSideEffects.mockResolvedValue({ attempted: 0, processed: 0, failed: 0 });
    reconcileSideEffects.mockResolvedValue({ scanned: 0, eligible: 0, enqueued: 0, skipped: 0 });
  });

  it('drena side effects por padrão para preservar o comportamento inline', async () => {
    await processAsaasWebhookQueueWithInbox({ contaId: 'conta-a', limit: 10 });

    expect(drainSideEffects).toHaveBeenCalledWith({ contaId: 'conta-a', limit: 50 });
  });

  it('permite ao scheduler separar o drain e executar side effects apenas uma vez', async () => {
    await processAsaasWebhookQueueWithInbox({
      contaId: 'conta-a',
      limit: 100,
      drainSideEffects: false,
    });

    expect(drainSideEffects).not.toHaveBeenCalled();
  });

  it('propaga referência e IDs externos opcionais até o candidate do inbox', async () => {
    processQueue.mockResolvedValue({
      processedPayments: [{
        contaId: 'conta-a', event: 'PAYMENT_RECEIVED', eventId: 'evt-1',
        asaasPaymentId: 'pay-1', asaasSubscriptionId: 'sub-1', asaasInstallmentId: 'inst-1',
        externalReference: 'alusa:subscription:mat-a:plan-a', occurredAt: null,
      }],
      processed: 1, failed: 0,
    });

    await processAsaasWebhookQueueWithInbox({ contaId: 'conta-a', limit: 10, drainSideEffects: false });

    expect(enqueueSideEffects).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a',
      candidates: [expect.objectContaining({
        asaasPaymentId: 'pay-1', asaasSubscriptionId: 'sub-1', asaasInstallmentId: 'inst-1',
        externalReference: 'alusa:subscription:mat-a:plan-a',
      })],
    }));
  });

  it('tenta recuperar no inbox quando a gravação do outbox falha', async () => {
    processQueue.mockResolvedValue({
      processedPayments: [{
        contaId: 'conta-a',
        event: 'PAYMENT_RECEIVED',
        eventId: 'evt-1',
        asaasPaymentId: 'pay-1',
        asaasSubscriptionId: null,
        occurredAt: new Date(),
      }],
      processed: 1,
      failed: 0,
    });
    enqueueSideEffects.mockRejectedValueOnce(new Error('database unavailable'));

    await processAsaasWebhookQueueWithInbox({ contaId: 'conta-a', limit: 10, drainSideEffects: false });

    expect(reconcileSideEffects).toHaveBeenCalledWith({
      contaId: 'conta-a',
      lookbackHours: 48,
      limit: 100,
    });
  });

  it('carrega a assinatura do pagamento até o candidato da notificação', async () => {
    processQueue.mockResolvedValue({
      processedPayments: [{
        contaId: 'conta-a', event: 'PAYMENT_RECEIVED', eventId: 'evt-2',
        asaasPaymentId: 'pay-legacy', asaasSubscriptionId: 'sub-legacy', occurredAt: null,
        externalReference: 'school-ref',
      }],
      processed: 1, failed: 0,
    });

    await processAsaasWebhookQueueWithInbox({ contaId: 'conta-a', drainSideEffects: false });

    expect(enqueueSideEffects).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [expect.objectContaining({
        asaasPaymentId: 'pay-legacy', asaasSubscriptionId: 'sub-legacy',
        externalReference: 'school-ref',
      })],
    }));
  });
});
