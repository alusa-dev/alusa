import { prisma } from '@alusa/database';
import { EventsError } from '@alusa/lib/events/events.service';
import { getEventAsaasPaymentProvider } from '@alusa/lib/events/event-asaas-payment-provider';
import {
  confirmPublicEventMapOrderPayment,
  getPublicEventMapOrderStatus,
  reconcileEventMapOrderFinancialStateFromAsaas,
} from '@alusa/lib/events/map/event-map.service';
import { loadDecryptedAsaasCredentials } from '@alusa/lib/services/integracoes/asaas-credentials-service';
import { Prisma } from '@prisma/client';

const PAYMENT_SYNC_WINDOW_MS = 15 * 60 * 1000;
const PAYMENT_SYNC_MAX_PER_WINDOW = 8;
const PAID_EVENT_MAP_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Buyer-triggered point-in-time payment verification for public seat orders.
 * Provider I/O and payment reconciliation belong to finance; the lib package
 * retains the order/map persistence primitives.
 */
export async function syncPublicEventMapOrderPaymentByBuyer(orderId: string, accessToken: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { id: orderId, accessToken },
    select: {
      id: true,
      contaId: true,
      status: true,
      ticketFulfillmentStatus: true,
      asaasPaymentId: true,
      accessToken: true,
    },
  });
  if (!order) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.', 404);

  if (order.status === 'CONFIRMED' && order.ticketFulfillmentStatus === 'ISSUED') {
    return {
      synced: false as const,
      status: order.status,
      order: await getPublicEventMapOrderStatus(orderId, accessToken),
    };
  }

  if (order.status === 'EXPIRED' || order.status === 'CANCELLED' || order.status === 'REFUNDED') {
    throw new EventsError('PEDIDO_ENCERRADO', 'Este pedido não está disponível para pagamento.', 409);
  }
  if (!order.asaasPaymentId) {
    throw new EventsError('COBRANCA_AUSENTE', 'Cobrança ainda não foi gerada para este pedido.', 409);
  }

  const recentSyncs = await prisma.auditLog.count({
    where: {
      contaId: order.contaId,
      entityType: 'EventMapOrder',
      entityId: order.id,
      action: 'events.map.public.sync_payment',
      createdAt: { gte: new Date(Date.now() - PAYMENT_SYNC_WINDOW_MS) },
    },
  });
  if (recentSyncs >= PAYMENT_SYNC_MAX_PER_WINDOW) {
    throw new EventsError('LIMITE_SINCRONIZACAO', 'Aguarde alguns minutos antes de tentar novamente.', 429);
  }

  const credentials = await loadDecryptedAsaasCredentials(order.contaId);
  if (!credentials?.apiKey) {
    throw new EventsError('ASAAS_NAO_CONFIGURADO', 'Integração Asaas não configurada.', 409);
  }
  const payment = await getEventAsaasPaymentProvider().getPayment({
    apiKey: credentials.apiKey,
    paymentId: order.asaasPaymentId,
  });
  const paymentStatus = (payment.status ?? '').trim().toUpperCase();

  await prisma.auditLog.create({
    data: {
      contaId: order.contaId,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'events.map.public.sync_payment',
      entityType: 'EventMapOrder',
      entityId: order.id,
      metadata: toAuditJson({ asaasPaymentId: order.asaasPaymentId, paymentStatus }),
    },
  });

  if (!PAID_EVENT_MAP_STATUSES.has(paymentStatus)) {
    return {
      synced: false as const,
      status: order.status,
      paymentStatus,
      order: await getPublicEventMapOrderStatus(orderId, accessToken),
    };
  }

  const paidAt = payment.paymentDate ?? payment.clientPaymentDate ?? new Date();
  const paymentParams = {
    contaId: order.contaId,
    asaasPaymentId: order.asaasPaymentId,
    externalReference: `event-map-order:${order.id}`,
    paymentStatus,
    invoiceUrl: payment.invoiceUrl ?? null,
    paidAt,
    paidAmount: payment.value ?? null,
  };

  let confirmationError: unknown = null;
  try {
    const confirmed = await confirmPublicEventMapOrderPayment({
      ...paymentParams,
      allowReleasedReservation: true,
    });
    if (!confirmed) {
      confirmationError = new EventsError(
        'PEDIDO_NAO_CONFIRMADO',
        'O pedido não pôde ser confirmado com o estado financeiro atual.',
        409,
      );
    }
  } catch (error) {
    confirmationError = error;
  }

  if (confirmationError) {
    if (!(confirmationError instanceof EventsError)) throw confirmationError;
    const reconciled = await reconcileEventMapOrderFinancialStateFromAsaas({
      ...paymentParams,
      ticketFulfillmentError: confirmationError.code,
    });
    if (!reconciled) throw confirmationError;
  }

  return {
    synced: true as const,
    status: 'CONFIRMED' as const,
    order: await getPublicEventMapOrderStatus(orderId, accessToken),
  };
}
