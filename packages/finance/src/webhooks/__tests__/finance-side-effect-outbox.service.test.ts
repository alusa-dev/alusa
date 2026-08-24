import { beforeEach, describe, expect, it, vi } from 'vitest';

const { outboxMock, emitBillingNotificationsMock } = vi.hoisted(() => ({
  outboxMock: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  emitBillingNotificationsMock: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    financeWebhookSideEffectOutbox: outboxMock,
  },
}));

vi.mock('@alusa/lib', () => ({
  emitBillingNotifications: emitBillingNotificationsMock,
  normalizeBillingNotificationEvent: (event: string) => event,
  buildBillingNotificationDedupeKey: (event: string, paymentId: string) => `payment:confirmed:${paymentId}`,
}));

import { FinanceWebhookSideEffectStatus } from '@prisma/client';
import {
  enqueueBillingNotificationSideEffects,
  processFinanceWebhookSideEffectOutboxEvent,
} from '../finance-side-effect-outbox.service';

function buildEvent(status: FinanceWebhookSideEffectStatus) {
  return {
    id: 'effect-1',
    contaId: 'conta-a',
    effectType: 'BILLING_NOTIFICATION',
    dedupeKey: 'dedupe-1',
    payload: {
      candidate: {
        event: 'PAYMENT_RECEIVED',
        asaasPaymentId: 'pay-1',
      },
      sourceType: 'ASAAS_WEBHOOK',
    },
    status,
    attempts: 1,
    availableAt: new Date('2026-08-13T10:00:00.000Z'),
    lockedAt: null,
    leaseExpiresAt: status === FinanceWebhookSideEffectStatus.PROCESSING
      ? new Date(Date.now() - 1_000)
      : null,
    lockToken: status === FinanceWebhookSideEffectStatus.PROCESSING ? 'old-token' : null,
    processedAt: null,
    lastAttemptAt: null,
    lastError: null,
    createdAt: new Date('2026-08-13T09:00:00.000Z'),
    updatedAt: new Date('2026-08-13T09:00:00.000Z'),
  };
}

describe('finance side-effect outbox leases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitBillingNotificationsMock.mockResolvedValue(undefined);
    outboxMock.create.mockResolvedValue({ id: 'effect-1' });
  });

  it('usa a mesma chave para eventos Asaas semanticamente equivalentes', async () => {
    const result = await enqueueBillingNotificationSideEffects({
      contaId: 'conta-a',
      sourceType: 'ASAAS_WEBHOOK',
      candidates: [
        { contaId: 'conta-a', event: 'PAYMENT_CONFIRMED', asaasPaymentId: 'pay-1' },
        { contaId: 'conta-a', event: 'PAYMENT_RECEIVED', asaasPaymentId: 'pay-1' },
      ],
    });

    expect(result).toEqual({ enqueued: 2, skipped: 0 });
    const firstKey = outboxMock.create.mock.calls[0]?.[0]?.data?.dedupeKey;
    const secondKey = outboxMock.create.mock.calls[1]?.[0]?.data?.dedupeKey;
    expect(firstKey).toBe('conta-a:BILLING_NOTIFICATION:payment:confirmed:pay-1');
    expect(secondKey).toBe(firstKey);
  });

  it('recupera PROCESSING expirado, mas não permite que o worker antigo finalize o evento', async () => {
    outboxMock.findUnique.mockResolvedValue(buildEvent(FinanceWebhookSideEffectStatus.PROCESSING));
    outboxMock.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await processFinanceWebhookSideEffectOutboxEvent('effect-1');

    expect(emitBillingNotificationsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: false, reason: 'lease_lost' });
    expect(outboxMock.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'effect-1',
          OR: expect.arrayContaining([
            expect.objectContaining({ status: FinanceWebhookSideEffectStatus.PROCESSING }),
          ]),
        }),
        data: expect.objectContaining({
          status: FinanceWebhookSideEffectStatus.PROCESSING,
          lockToken: expect.any(String),
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(outboxMock.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: FinanceWebhookSideEffectStatus.PROCESSING,
          lockToken: expect.any(String),
        }),
      }),
    );
  });

  it('processa PENDING e limpa o token somente com a posse atual do lease', async () => {
    outboxMock.findUnique.mockResolvedValue(buildEvent(FinanceWebhookSideEffectStatus.PENDING));
    outboxMock.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const result = await processFinanceWebhookSideEffectOutboxEvent('effect-1');

    expect(result).toEqual({ processed: true });
    expect(emitBillingNotificationsMock).toHaveBeenCalledTimes(1);
    expect(outboxMock.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: FinanceWebhookSideEffectStatus.PROCESSED,
          lockToken: null,
          leaseExpiresAt: null,
        }),
      }),
    );
  });

  it('não marca ingresso como enviado quando o Resend não está configurado', async () => {
    const previousApiKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    outboxMock.findUnique.mockResolvedValue({
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_PUBLIC_ORDER_TICKET_EMAIL',
      payload: {
        orderId: 'order-1',
        buyerEmail: 'buyer@example.com',
        buyerName: 'Buyer',
        eventName: 'Event',
        eventStartsAt: '2026-08-23T20:00:00.000Z',
        ticketCount: 1,
        ticketsPath: '/tickets',
        ticketsHtmlPath: '/tickets/html',
        statusPath: '/order',
      },
    } as never);
    outboxMock.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    try {
      const result = await processFinanceWebhookSideEffectOutboxEvent('effect-1');

      expect(result).toEqual({
        processed: false,
        reason: 'RESEND_API_KEY ausente; e-mail não foi enviado.',
      });
      expect(outboxMock.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            status: FinanceWebhookSideEffectStatus.PENDING,
            lastError: 'RESEND_API_KEY ausente; e-mail não foi enviado.',
          }),
        }),
      );
    } finally {
      if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousApiKey;
    }
  });
});
