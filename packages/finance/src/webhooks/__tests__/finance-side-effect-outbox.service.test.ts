import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  outboxMock,
  webhookAsaasMock,
  eventMapOrderMock,
  emitBillingNotificationsMock,
  listPaymentRefundsMock,
  refundCobrancaMock,
  requestBankSlipRefundMock,
  sendBankSlipRefundNoticeMock,
} = vi.hoisted(() => ({
  outboxMock: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  webhookAsaasMock: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  eventMapOrderMock: { findFirst: vi.fn() },
  emitBillingNotificationsMock: vi.fn(),
  listPaymentRefundsMock: vi.fn(),
  refundCobrancaMock: vi.fn(),
  requestBankSlipRefundMock: vi.fn(),
  sendBankSlipRefundNoticeMock: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    financeWebhookSideEffectOutbox: outboxMock,
    webhookAsaas: webhookAsaasMock,
    eventMapOrder: eventMapOrderMock,
  },
}));

vi.mock('@alusa/lib', () => ({
  emitBillingNotifications: emitBillingNotificationsMock,
  normalizeBillingNotificationEvent: (event: string) => event,
  buildBillingNotificationDedupeKey: (event: string, paymentId: string) => `payment:confirmed:${paymentId}`,
}));

vi.mock('@alusa/lib/notifications/emit-billing-notifications', () => ({
  emitBillingNotifications: emitBillingNotificationsMock,
}));

vi.mock('@alusa/lib/services/notifications.service', () => ({
  normalizeBillingNotificationEvent: (event: string) => event,
  buildBillingNotificationDedupeKey: (event: string, paymentId: string) => `payment:confirmed:${paymentId}`,
}));

vi.mock('../../use-cases/asaas-ops', () => ({
  listPaymentRefunds: listPaymentRefundsMock,
  refundCobranca: refundCobrancaMock,
  requestBankSlipRefund: requestBankSlipRefundMock,
}));

vi.mock('../finance-side-effect-email-gateway', () => ({
  getFinanceSideEffectEmailGateway: () => ({
    sendBankSlipRefundNotice: sendBankSlipRefundNoticeMock,
  }),
}));

import { FinanceWebhookSideEffectStatus } from '@prisma/client';
import {
  enqueueBillingNotificationSideEffects,
  reconcileMissingBillingNotificationSideEffects,
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
    listPaymentRefundsMock.mockResolvedValue({ data: [] });
    refundCobrancaMock.mockResolvedValue({ success: true, message: 'Reembolso solicitado' });
    requestBankSlipRefundMock.mockResolvedValue({ requestUrl: 'https://sandbox.asaas.com/solicitar-estorno/abc' });
    sendBankSlipRefundNoticeMock.mockResolvedValue({ id: 'email-refund-1' });
    eventMapOrderMock.findFirst.mockResolvedValue({
      buyerEmail: 'buyer@example.com',
      buyerName: 'Comprador',
      paymentMethod: 'PIX',
      event: { name: 'Evento de teste' },
    });
    outboxMock.updateMany.mockResolvedValue({ count: 1 });
    outboxMock.create.mockResolvedValue({ id: 'effect-1' });
    webhookAsaasMock.findMany.mockResolvedValue([]);
    webhookAsaasMock.updateMany.mockResolvedValue({ count: 1 });
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

  it('solicita um único estorno tardio e grava a intenção antes do POST ao Asaas', async () => {
    const event = {
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
      payload: {
        orderId: 'order-1',
        asaasPaymentId: 'pay-1',
        value: 60,
        description: 'Estorno por assento revendido - pedido order-1',
        requestState: 'NOT_SUBMITTED',
      },
      attempts: 0,
    };
    outboxMock.findUnique.mockResolvedValue(event);
    listPaymentRefundsMock.mockResolvedValueOnce({ data: [] });

    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);

    expect(result).toEqual({
      processed: false,
      reason: 'Estorno solicitado; aguardando confirmação de conclusão pelo Asaas.',
    });
    expect(listPaymentRefundsMock).toHaveBeenCalledWith({ paymentId: 'pay-1', contaId: 'conta-a' });
    expect(outboxMock.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: event.id, lockToken: expect.any(String) }),
      data: expect.objectContaining({
        payload: expect.objectContaining({ requestState: 'SUBMITTING' }),
      }),
    }));
    expect(refundCobrancaMock).toHaveBeenCalledWith({
      paymentId: 'pay-1',
      contaId: 'conta-a',
      value: 60,
      description: 'Estorno por assento revendido - pedido order-1',
    });
  });

  it('inicia estorno de boleto uma vez, persiste o link do Asaas e notifica o pagador', async () => {
    const event = {
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
      payload: {
        orderId: 'order-boleto',
        asaasPaymentId: 'pay-boleto',
        value: 60,
        description: 'Estorno por assento revendido - pedido order-boleto',
        requestState: 'NOT_SUBMITTED',
      },
      attempts: 0,
    };
    outboxMock.findUnique.mockResolvedValue(event);
    eventMapOrderMock.findFirst.mockResolvedValue({
      buyerEmail: 'boleto@example.com',
      buyerName: 'Comprador Boleto',
      paymentMethod: 'BOLETO',
      event: { name: 'Festival de teste' },
    });

    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);

    expect(result).toEqual({ processed: true });
    expect(requestBankSlipRefundMock).toHaveBeenCalledWith({ paymentId: 'pay-boleto', contaId: 'conta-a' });
    expect(refundCobrancaMock).not.toHaveBeenCalled();
    expect(sendBankSlipRefundNoticeMock).toHaveBeenCalledWith({
      orderId: 'order-boleto',
      buyerEmail: 'boleto@example.com',
      buyerName: 'Comprador Boleto',
      eventName: 'Festival de teste',
      requestUrl: 'https://sandbox.asaas.com/solicitar-estorno/abc',
    });
    expect(outboxMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          requestState: 'AWAITING_CUSTOMER_ACTION',
          bankSlipRefundRequestUrl: 'https://sandbox.asaas.com/solicitar-estorno/abc',
        }),
      }),
    }));
    expect(outboxMock.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: FinanceWebhookSideEffectStatus.PROCESSED,
        providerMessageId: 'email-refund-1',
        deliveryStatus: 'SENT',
      }),
    }));
  });

  it('não repete uma solicitação de estorno de boleto quando o resultado anterior é incerto', async () => {
    const event = {
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
      payload: {
        orderId: 'order-boleto-unknown',
        asaasPaymentId: 'pay-boleto-unknown',
        value: 60,
        description: 'Estorno por assento revendido - pedido order-boleto-unknown',
        requestState: 'SUBMITTING',
      },
      attempts: 1,
    };
    outboxMock.findUnique.mockResolvedValue(event);
    listPaymentRefundsMock.mockResolvedValue({ data: [] });

    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);

    expect(result.processed).toBe(false);
    expect(requestBankSlipRefundMock).not.toHaveBeenCalled();
    expect(sendBankSlipRefundNoticeMock).not.toHaveBeenCalled();
  });

  it('reenvia a instrução do boleto quando o Asaas já aguarda os dados do pagador', async () => {
    const event = {
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
      payload: {
        orderId: 'order-boleto-retry',
        asaasPaymentId: 'pay-boleto-retry',
        value: 60,
        description: 'Estorno por assento revendido - pedido order-boleto-retry',
        requestState: 'AWAITING_CUSTOMER_ACTION',
        bankSlipRefundRequestUrl: 'https://sandbox.asaas.com/solicitar-estorno/pay-boleto-retry',
      },
      attempts: 1,
    };
    outboxMock.findUnique.mockResolvedValue(event);
    listPaymentRefundsMock.mockResolvedValue({ data: [{
      dateCreated: '2026-09-25',
      status: 'AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION',
      value: 60,
      description: 'Estorno por assento revendido - pedido order-boleto-retry',
    }] });
    eventMapOrderMock.findFirst.mockResolvedValue({
      buyerEmail: 'boleto@example.com',
      buyerName: 'Comprador Boleto',
      event: { name: 'Festival de teste' },
    });

    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);

    expect(result).toEqual({ processed: true });
    expect(requestBankSlipRefundMock).not.toHaveBeenCalled();
    expect(sendBankSlipRefundNoticeMock).toHaveBeenCalledWith(expect.objectContaining({
      requestUrl: 'https://sandbox.asaas.com/solicitar-estorno/pay-boleto-retry',
    }));
  });

  it('só conclui o efeito de estorno quando o Asaas confirma status DONE', async () => {
    const event = {
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
      payload: {
        orderId: 'order-1',
        asaasPaymentId: 'pay-1',
        value: 60,
        description: 'Estorno por assento revendido - pedido order-1',
        requestState: 'SUBMITTING',
      },
      attempts: 1,
    };
    outboxMock.findUnique.mockResolvedValue(event);
    listPaymentRefundsMock.mockResolvedValue({ data: [{
      dateCreated: '2026-09-25',
      status: 'DONE',
      value: 60,
      description: 'Estorno por assento revendido - pedido order-1',
    }] });

    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);

    expect(result).toEqual({ processed: true });
    expect(refundCobrancaMock).not.toHaveBeenCalled();
    expect(outboxMock.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: FinanceWebhookSideEffectStatus.PROCESSED }),
    }));
  });

  it('considera PENDING um estorno aceito e deixa a conclusão para o webhook financeiro', async () => {
    const event = {
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
      payload: {
        orderId: 'order-1',
        asaasPaymentId: 'pay-1',
        value: 60,
        description: 'Estorno por indisponibilidade dos assentos - pedido order-1',
        requestState: 'SUBMITTING',
      },
      attempts: 1,
    };
    outboxMock.findUnique.mockResolvedValue(event);
    listPaymentRefundsMock.mockResolvedValue({ data: [{
      dateCreated: '2026-09-25',
      status: 'PENDING',
      value: 60,
      description: 'Estorno por indisponibilidade dos assentos - pedido order-1',
    }] });
    outboxMock.updateMany.mockResolvedValue({ count: 1 });

    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);

    expect(result).toEqual({ processed: true });
    expect(refundCobrancaMock).not.toHaveBeenCalled();
    expect(outboxMock.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ status: FinanceWebhookSideEffectStatus.PROCESSED }),
    }));
  });

  it('não repete o POST quando o resultado do estorno anterior ainda é incerto', async () => {
    const event = {
      ...buildEvent(FinanceWebhookSideEffectStatus.PENDING),
      effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
      payload: {
        orderId: 'order-1',
        asaasPaymentId: 'pay-1',
        value: 60,
        description: 'Estorno por assento revendido - pedido order-1',
        requestState: 'SUBMITTING',
      },
      attempts: 1,
    };
    outboxMock.findUnique.mockResolvedValue(event);

    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);

    expect(result.processed).toBe(false);
    expect(refundCobrancaMock).not.toHaveBeenCalled();
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

  it('mantém EXHAUSTED terminal e não chama o provedor novamente', async () => {
    outboxMock.findUnique.mockResolvedValue(buildEvent(FinanceWebhookSideEffectStatus.EXHAUSTED));

    const result = await processFinanceWebhookSideEffectOutboxEvent('effect-1');

    expect(result).toEqual({ processed: false, reason: 'exhausted' });
    expect(emitBillingNotificationsMock).not.toHaveBeenCalled();
    expect(outboxMock.updateMany).not.toHaveBeenCalled();
  });

  it('reconstrói efeitos ausentes a partir do inbox processado com deduplicação', async () => {
    webhookAsaasMock.findMany.mockResolvedValue([{
      id: 'webhook-1',
      contaId: 'conta-a',
      evento: 'PAYMENT_RECEIVED',
      eventId: 'evt-1',
      asaasPaymentId: 'pay-1',
      recebidoEm: new Date('2026-09-21T12:00:00.000Z'),
    }]);

    const result = await reconcileMissingBillingNotificationSideEffects({
      contaId: 'conta-a',
      lookbackHours: 24,
      limit: 10,
    });

    expect(result).toEqual({ scanned: 1, eligible: 1, enqueued: 1, skipped: 0 });
    expect(outboxMock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'conta-a',
        effectType: 'BILLING_NOTIFICATION',
        dedupeKey: 'conta-a:BILLING_NOTIFICATION:payment:confirmed:pay-1',
      }),
    }));
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

  it('envia erro permanente do provedor para EXHAUSTED sem consumir retries', async () => {
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
            status: FinanceWebhookSideEffectStatus.EXHAUSTED,
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
