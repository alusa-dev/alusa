import { Prisma } from '@prisma/client';
import { prisma } from '@alusa/database';
import {
  cancelPublicEventMapOrder,
  confirmPublicEventMapOrderPayment,
  enqueuePublicOrderCreatedEmail,
  preparePublicEventMapCheckout,
  reconcileEventMapOrderFinancialStateFromAsaas,
  buildPublicEventMapCheckoutResponse,
  publicOrderStatusPath,
} from '@alusa/lib/events/map/event-map.service';
import type { PublicCheckoutInput } from '@alusa/lib/events/map/event-map.service';
import { getEventAsaasPaymentProvider, type EventAsaasPayment } from '@alusa/lib/events/event-asaas-payment-provider';
import { EventsError } from '@alusa/lib/events/events.service';
import { loadDecryptedAsaasCredentials } from '@alusa/lib/services/integracoes/asaas-credentials-service';

const PAID_ASAAS_PAYMENT_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);
const CANCELLABLE_ASAAS_PAYMENT_STATUSES = new Set(['PENDING', 'OVERDUE']);

function toMoney(value: number | Prisma.Decimal | null | undefined): number {
  const amount = value instanceof Prisma.Decimal ? value.toNumber() : Number(value ?? 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function toAsaasDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildEventMapAsaasIdempotencyKey(scope: 'customer' | 'payment', orderId: string) {
  return `event-map:${scope}:${orderId}`;
}

async function buildCheckoutResponse(
  order: Parameters<typeof buildPublicEventMapCheckoutResponse>[0],
  params: { apiKey?: string | null; paymentMethod: PublicCheckoutInput['paymentMethod']; publicSlug: string | null },
) {
  let pixQrCode: { encodedImage: string; payload: string; expirationDate: string } | null = null;
  let bankSlipCode: string | null = null;
  let bankSlipBarcode: string | null = null;
  if (params.apiKey && order.asaasPaymentId && params.paymentMethod === 'PIX') {
    try {
      pixQrCode = await getEventAsaasPaymentProvider().getPixQrCode({
        apiKey: params.apiKey,
        paymentId: order.asaasPaymentId,
      });
    } catch (error) {
      console.warn('[event-map] Falha ao obter QR Code Pix:', { orderId: order.id, error });
    }
  }
  if (params.apiKey && order.asaasPaymentId && params.paymentMethod === 'BOLETO') {
    try {
      const bankSlip = await getEventAsaasPaymentProvider().getBankSlipBillingInfo({
        apiKey: params.apiKey,
        paymentId: order.asaasPaymentId,
      });
      bankSlipCode = bankSlip?.identificationField ?? bankSlip?.barCode ?? null;
      bankSlipBarcode = bankSlip?.barCode ?? null;
    } catch (error) {
      console.warn('[event-map] Falha ao obter código do boleto:', { orderId: order.id, error });
    }
  }
  return buildPublicEventMapCheckoutResponse(order, {
    publicSlug: params.publicSlug,
    pixQrCode,
    bankSlipCode,
    bankSlipBarcode,
  });
}

export async function completePublicEventMapCheckout(publicSlug: string, input: PublicCheckoutInput) {
  const buyerDocument = input.buyerDocument?.replace(/\D/g, '') ?? '';
  const pending = await preparePublicEventMapCheckout(publicSlug, input);
  console.info('[events.finance]', {
    action: 'eventMapOrder.checkout.prepared',
    contaId: pending.map.contaId,
    eventId: pending.map.eventId,
    orderId: pending.order.id,
    updated: Boolean(pending.order.asaasPaymentId),
  });

  let paymentCreationClaimed = false;
  let paymentCreationStarted = false;
  try {
    const credentials = await loadDecryptedAsaasCredentials(pending.map.contaId);
    if (!credentials?.apiKey) {
      throw new EventsError('ASAAS_NAO_CONFIGURADO', 'Configure a integração Asaas para vender ingressos no mapa público.', 409);
    }

    if (pending.order.asaasPaymentId) {
      return buildCheckoutResponse(pending.order, {
        apiKey: credentials.apiKey,
        paymentMethod: input.paymentMethod,
        publicSlug: pending.map.publicSlug,
      });
    }

    const externalReference = `event-map-order:${pending.order.id}`;
    // Always reconcile by our stable external reference before attempting a
    // payment POST. Asaas may have accepted an earlier request whose response
    // was lost before this order persisted the remote ID.
    const remotePayments = await getEventAsaasPaymentProvider().listPayments({
      apiKey: credentials.apiKey,
      externalReference,
      limit: 10,
    });
    const existingPayments = remotePayments.data.filter((candidate) => !candidate.deleted);
    if (existingPayments.length > 1) {
      throw new EventsError(
        'COBRANCAS_DUPLICADAS_EM_RECONCILIACAO',
        'Encontramos mais de uma cobrança para este pedido. A equipe da instituição precisa verificar antes de continuar.',
        409,
      );
    }
    const existingPayment = existingPayments[0];
    if (existingPayment) {
      const expectedValue = toMoney(pending.totalAmount);
      const remoteValue = typeof existingPayment.value === 'number' ? toMoney(existingPayment.value) : null;
      const currentOrder = await prisma.eventMapOrder.findFirst({
        where: { id: pending.order.id, contaId: pending.map.contaId },
        select: { asaasCustomerId: true },
      });
      if (
        remoteValue !== expectedValue ||
        existingPayment.billingType !== input.paymentMethod ||
        (currentOrder?.asaasCustomerId && existingPayment.customer !== currentOrder.asaasCustomerId)
      ) {
        throw new EventsError(
          'COBRANCA_DIVERGENTE_EM_RECONCILIACAO',
          'A cobrança encontrada não corresponde aos dados desta compra e precisa de verificação antes de continuar.',
          409,
        );
      }
      const attached = await prisma.eventMapOrder.update({
        where: { id: pending.order.id },
        data: {
          asaasPaymentId: existingPayment.id,
          paymentStatus: existingPayment.status ?? 'PENDING',
          paymentProvider: 'ASAAS',
          invoiceUrl: existingPayment.invoiceUrl ?? null,
        },
        include: { items: { include: { ticket: true } } },
      });
      return buildCheckoutResponse(attached, {
        apiKey: credentials.apiKey,
        paymentMethod: input.paymentMethod,
        publicSlug: pending.map.publicSlug,
      });
    }

    if (pending.order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' ||
        pending.order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN') {
      throw new EventsError(
        'PAGAMENTO_EM_VERIFICACAO',
        'Estamos verificando a cobrança com o provedor. Aguarde um pouco e tente consultar o pedido novamente.',
        409,
      );
    }

    const creationClaim = await prisma.eventMapOrder.updateMany({
      where: {
        id: pending.order.id,
        contaId: pending.map.contaId,
        status: 'PAYMENT_PENDING',
        asaasPaymentId: null,
        paymentStatus: pending.order.paymentStatus,
      },
      data: { paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' },
    });
    if (creationClaim.count !== 1) {
      throw new EventsError(
        'PAGAMENTO_EM_VERIFICACAO',
        'Estamos verificando a cobrança com o provedor. Aguarde um pouco e tente consultar o pedido novamente.',
        409,
      );
    }
    paymentCreationClaimed = true;

    const existing = await getEventAsaasPaymentProvider().listCustomers({
      apiKey: credentials.apiKey,
      cpfCnpj: buyerDocument,
      limit: 10,
    });
    const activeCustomer = existing.data.find((customer) => !customer.deleted);
    let customerId = activeCustomer?.id ?? '';
    if (activeCustomer) {
      // A transient lookup/update failure must stop checkout. Creating a second
      // customer on that failure can silently fragment payment history for the
      // same buyer. The outer handler safely releases the pre-POST claim.
      await getEventAsaasPaymentProvider().updateCustomer({
        apiKey: credentials.apiKey,
        customerId,
        data: {
          name: input.buyerName,
          email: input.buyerEmail,
          mobilePhone: input.buyerPhone,
          externalReference: `event-map-order:${pending.order.id}`,
        },
      });
    }

    if (!customerId) {
      const customer = await getEventAsaasPaymentProvider().createCustomer({
        apiKey: credentials.apiKey,
        idempotencyKey: buildEventMapAsaasIdempotencyKey('customer', pending.order.id),
        data: {
          name: input.buyerName,
          email: input.buyerEmail,
          cpfCnpj: buyerDocument,
          mobilePhone: input.buyerPhone,
          externalReference: `event-map-order:${pending.order.id}`,
          notificationDisabled: false,
        },
      });
      customerId = customer.id;
    }

    let payment: EventAsaasPayment;
    try {
      console.info('[events.finance]', {
        action: 'eventMapOrder.payment.create.start',
        contaId: pending.map.contaId,
        eventId: pending.map.eventId,
        orderId: pending.order.id,
      });
      const requestClaim = await prisma.eventMapOrder.updateMany({
        where: {
          id: pending.order.id,
          contaId: pending.map.contaId,
          status: 'PAYMENT_PENDING',
          asaasPaymentId: null,
          paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
        },
        data: {
          paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
          asaasCustomerId: customerId,
          paymentMethod: input.paymentMethod,
        },
      });
      if (requestClaim.count !== 1) {
        throw new EventsError('PAGAMENTO_EM_VERIFICACAO', 'A tentativa de cobrança foi assumida por outra requisição.', 409);
      }
      paymentCreationStarted = true;
      payment = await getEventAsaasPaymentProvider().createPayment({
        apiKey: credentials.apiKey,
        idempotencyKey: buildEventMapAsaasIdempotencyKey('payment', pending.order.id),
        data: {
          customer: customerId,
          value: pending.totalAmount,
          dueDate: toAsaasDate(pending.expiresAt),
          billingType: input.paymentMethod,
          description: `Ingressos - ${pending.map.event.name}`,
          externalReference,
        },
      });
    } catch (paymentError) {
      const reconciled = await getEventAsaasPaymentProvider().listPayments({
        apiKey: credentials.apiKey,
        externalReference,
        limit: 10,
      }).catch((listError) => {
        console.warn('[event-map] Falha ao reconciliar cobrança Asaas por externalReference:', listError);
        return null;
      });
      const existingPayment = reconciled?.data.find((candidate) => !candidate.deleted) ?? null;
      if (!existingPayment) throw paymentError;
      payment = existingPayment;
    }

    console.info('[events.finance]', {
      action: 'eventMapOrder.payment.create',
      contaId: pending.map.contaId,
      eventId: pending.map.eventId,
      orderId: pending.order.id,
      asaasPaymentId: payment.id,
    });

    const attached = await prisma.eventMapOrder.updateMany({
      where: {
        id: pending.order.id,
        contaId: pending.map.contaId,
        status: 'PAYMENT_PENDING',
        asaasPaymentId: null,
        paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
      },
      data: {
        asaasCustomerId: customerId,
        asaasPaymentId: payment.id,
        paymentMethod: input.paymentMethod,
        paymentStatus: payment.status,
        invoiceUrl: payment.invoiceUrl ?? null,
      },
    });
    const updated = await prisma.eventMapOrder.findFirst({
      where: { id: pending.order.id, contaId: pending.map.contaId },
      include: { items: { include: { ticket: true } } },
    });
    if (!updated) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado após criar a cobrança.', 404);

    if (attached.count !== 1 && updated.asaasPaymentId !== payment.id) {
      // The hold expired while the provider request was in flight. Persist the
      // provider identity for reconciliation, cancel a still-payable charge,
      // and never return a live checkout URL for an order whose seats were
      // released to another buyer.
      await prisma.eventMapOrder.updateMany({
        where: {
          id: updated.id,
          contaId: pending.map.contaId,
          status: { in: ['EXPIRED', 'CANCELLED'] },
          asaasPaymentId: null,
        },
        data: {
          asaasPaymentId: payment.id,
          asaasCustomerId: customerId,
          paymentMethod: input.paymentMethod,
          paymentStatus: payment.status,
          paymentProvider: 'ASAAS',
          invoiceUrl: payment.invoiceUrl ?? null,
        },
      });
      const paymentStatus = (payment.status ?? '').trim().toUpperCase();
      if (PAID_ASAAS_PAYMENT_STATUSES.has(paymentStatus)) {
        const latePaymentParams = {
          contaId: pending.map.contaId,
          asaasPaymentId: payment.id,
          externalReference,
          paymentStatus,
          invoiceUrl: payment.invoiceUrl ?? null,
          paidAt: payment.paymentDate ?? payment.clientPaymentDate ?? new Date(),
          paidAmount: payment.value ?? null,
          allowReleasedReservation: true,
        };
        const confirmed = await confirmPublicEventMapOrderPayment(latePaymentParams).catch(() => null);
        if (!confirmed) {
          await reconcileEventMapOrderFinancialStateFromAsaas({
            ...latePaymentParams,
            ticketFulfillmentError: 'PAYMENT_CREATED_AFTER_RESERVATION_EXPIRED',
          });
        }
      } else if (!payment.deleted && CANCELLABLE_ASAAS_PAYMENT_STATUSES.has(paymentStatus)) {
        await getEventAsaasPaymentProvider().deletePayment({ apiKey: credentials.apiKey, paymentId: payment.id }).catch((deleteError) => {
          console.error('[events.finance] Falha ao cancelar cobrança criada após expiração da reserva', {
            contaId: pending.map.contaId,
            eventId: pending.map.eventId,
            orderId: updated.id,
            asaasPaymentId: payment.id,
            message: deleteError instanceof Error ? deleteError.message : String(deleteError),
          });
        });
      }
      throw new EventsError(
        'RESERVA_EXPIRADA',
        'O prazo da reserva terminou enquanto a cobrança era criada. Consulte o pedido ou fale com a instituição.',
        409,
      );
    }

    await prisma.$transaction(async (tx) => {
      await enqueuePublicOrderCreatedEmail(tx, {
        contaId: pending.map.contaId,
        orderId: updated.id,
        buyerEmail: updated.buyerEmail,
        buyerName: updated.buyerName,
        eventName: pending.map.event.name,
        eventStartsAt: pending.map.event.startsAt,
        statusPath: publicOrderStatusPath(pending.map.publicSlug, updated.id, updated.accessToken),
        invoiceUrl: updated.invoiceUrl,
        paymentMethod: input.paymentMethod,
        expiresAt: pending.expiresAt,
      });
    });

    return buildCheckoutResponse(updated, {
      apiKey: credentials.apiKey,
      paymentMethod: input.paymentMethod,
      publicSlug: pending.map.publicSlug,
    });
  } catch (error) {
    if (paymentCreationClaimed && !paymentCreationStarted) {
      // Customer lookup/creation failed before any payment POST was attempted,
      // so it is safe to release the claim and cancel the local checkout.
      const released = await prisma.eventMapOrder.updateMany({
        where: {
          id: pending.order.id,
          contaId: pending.map.contaId,
          paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
          asaasPaymentId: null,
        },
        data: { paymentStatus: pending.order.paymentStatus },
      });
      paymentCreationClaimed = released.count === 0;
    }
    const currentOrder = await prisma.eventMapOrder.findUnique({
      where: { id: pending.order.id },
      select: { asaasPaymentId: true, paymentStatus: true },
    });
    const unresolvedPaymentCreation = currentOrder?.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS'
      || currentOrder?.paymentStatus === 'PAYMENT_CREATION_UNKNOWN';
    if (!currentOrder?.asaasPaymentId && !unresolvedPaymentCreation && !paymentCreationClaimed && !paymentCreationStarted) {
      await cancelPublicEventMapOrder(pending.order.id, 'Falha ao gerar cobrança Asaas.');
    }
    throw error;
  }
}

export type PublicCheckoutDTO = Awaited<ReturnType<typeof completePublicEventMapCheckout>>;
