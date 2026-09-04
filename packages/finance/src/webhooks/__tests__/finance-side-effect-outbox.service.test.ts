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

  it('envia ingressos pelo template publicado do Resend com as variáveis do evento', async () => {
    const previousApiKey = process.env.RESEND_API_KEY;
    const previousSender = process.env.EMAIL_FROM_EVENTS;
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM_EVENTS = 'Alusa Eventos <eventos@alusa.app>';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    outboxMock.findUnique.mockResolvedValue({
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_PUBLIC_ORDER_TICKET_EMAIL',
      payload: {
        orderId: 'order-1',
        buyerEmail: 'buyer@example.com',
        buyerName: 'Buyer',
        eventName: 'Evento Alusa',
        eventStartsAt: '2026-08-23T20:00:00.000Z',
        eventLocation: 'Teatro Alusa',
        ticketType: 'Inteira',
        ticketCount: 1,
        ticketsPath: '/tickets',
        statusPath: '/order',
      },
    } as never);
    outboxMock.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    try {
      const result = await processFinanceWebhookSideEffectOutboxEvent('effect-1');

      expect(result).toEqual({ processed: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect(request.headers).toEqual(expect.objectContaining({
        Authorization: 'Bearer test-key',
        'Idempotency-Key': 'event-ticket-email:order-1:initial',
      }));
      expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
        from: 'Alusa Eventos <eventos@alusa.app>',
        to: ['buyer@example.com'],
        template: {
          id: 'c395cbe5-b1fb-4d2d-ae3f-825e1e0d94e0',
          variables: expect.objectContaining({
            BUYER_NAME: 'Buyer',
            EVENT_NAME: 'Evento Alusa',
            EVENT_LOCATION: 'Teatro Alusa',
            TICKET_TYPE: 'Inteira',
            TICKETS_URL: expect.stringContaining('/tickets'),
          }),
        },
      }));
      expect(outboxMock.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            providerMessageId: 'email-1',
            deliveryStatus: 'SENT',
            deliveryStatusAt: expect.any(Date),
          }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousApiKey;
      if (previousSender === undefined) delete process.env.EMAIL_FROM_EVENTS;
      else process.env.EMAIL_FROM_EVENTS = previousSender;
    }
  });

  it('envia erro permanente do provedor para FAILED sem consumir retries', async () => {
    const previousApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Template inválido' }), { status: 422 }),
    ));
    outboxMock.findUnique.mockResolvedValue({
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_PUBLIC_ORDER_TICKET_EMAIL',
      payload: {
        orderId: 'order-1',
        buyerEmail: 'buyer@example.com',
        buyerName: 'Buyer',
        eventName: 'Evento Alusa',
        eventStartsAt: '2026-08-23T20:00:00.000Z',
        ticketCount: 1,
        ticketsPath: '/tickets',
      },
    } as never);
    outboxMock.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    try {
      const result = await processFinanceWebhookSideEffectOutboxEvent('effect-1');

      expect(result).toEqual({ processed: false, reason: 'Template inválido' });
      expect(outboxMock.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            status: FinanceWebhookSideEffectStatus.FAILED,
            deliveryStatus: 'FAILED',
            lastError: 'Template inválido',
          }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousApiKey;
    }
  });
});
