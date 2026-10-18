import { Prisma } from '@prisma/client';
import { prisma } from '@alusa/database';
import { preparePublicEventMapCheckout } from '@alusa/lib/events/map/public-event-map-checkout-persistence';
import { publicOrderStatusPath } from '@alusa/lib/events/map/public-order-links';
import { buildPublicEventMapCheckoutResponse } from './public-event-map-checkout-response';
import { enqueuePublicOrderCreatedEmail } from './public-order-created-email';
import { confirmPublicEventMapOrderPayment } from './confirm-public-event-map-order-payment';
import { cancelPublicEventMapOrder } from '@alusa/lib/events/map/event-map-order-operations';
import { reconcileEventMapOrderFinancialStateFromAsaas } from './event-map-payment-transitions';
import type { PublicCheckoutInput } from '@alusa/lib/events/map/event-map.schema';
import {
  getEventAsaasPaymentProvider,
  listCompleteEventCustomersByDocument,
  listCompleteEventPaymentsByReference,
  selectUniqueActiveEventPayment,
  type EventAsaasPayment,
} from './event-asaas-payment-provider';
import { EventsError } from '@alusa/domain/events';
import { loadDecryptedAsaasCredentials } from '../foundation/load-decrypted-asaas-credentials';
import { parseFirstValidCivilDatePreservingInstant } from '../mappers/civil-date';
import { logEventsFinance } from './events-finance-observability';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';

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

async function requireBuyerAsaasCustomerId(input: {
  apiKey: string;
  buyerDocument: string;
  localCustomerId?: string | null;
}) {
  const customers = await listCompleteEventCustomersByDocument({
    apiKey: input.apiKey,
    cpfCnpj: input.buyerDocument,
  });
  const matches = customers.filter((customer) => !customer.deleted);
  if (matches.length !== 1 || !matches[0]?.id || (input.localCustomerId && input.localCustomerId !== matches[0].id)) {
    throw new Error('BUYER_ASAAS_CUSTOMER_NOT_UNIQUELY_CONFIRMED');
  }
  return matches[0].id;
}

async function markEventMapPaymentReconciliationRequired(input: {
  contaId: string;
  orderId: string;
  expectedPaymentStatus: string | null;
  externalReference: string;
  reason: string;
  metadata?: Prisma.InputJsonObject;
}) {
  await prisma.eventMapOrder.updateMany({
    where: {
      id: input.orderId,
      contaId: input.contaId,
      status: 'PAYMENT_PENDING',
      asaasPaymentId: null,
      paymentStatus: input.expectedPaymentStatus,
    },
    data: { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
  });
  await upsertFinanceReconciliationIssue({
    contaId: input.contaId,
    entityType: 'PAYMENT',
    entityId: input.orderId,
    issueType: 'BILLING_OPERATION_UNCERTAIN',
    severity: 'CRITICAL',
    localStatus: 'PAYMENT_CREATION_UNKNOWN',
    remoteStatus: input.reason,
    metadata: {
      orderId: input.orderId,
      externalReference: input.externalReference,
      ...input.metadata,
    },
  });
}

async function buildCheckoutResponse(
  order: Parameters<typeof buildPublicEventMapCheckoutResponse>[0],
  params: {
    apiKey?: string | null;
    paymentMethod: PublicCheckoutInput['paymentMethod'];
    publicSlug: string | null;
  },
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
      logEventsFinance('finance.events.public_event_map.checkout.pix_qr.failed', { error }, 'warn');
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
      logEventsFinance(
        'finance.events.public_event_map.checkout.bank_slip.failed',
        { error },
        'warn',
      );
    }
  }
  return buildPublicEventMapCheckoutResponse(order, {
    publicSlug: params.publicSlug,
    pixQrCode,
    bankSlipCode,
    bankSlipBarcode,
  });
}

export async function completePublicEventMapCheckout(
  publicSlug: string,
  input: PublicCheckoutInput,
) {
  const buyerDocument = input.buyerDocument?.replace(/\D/g, '') ?? '';
  const pending = await preparePublicEventMapCheckout(publicSlug, input);
  let paymentCreationClaimed = false;
  let paymentCreationStarted = false;
  let paymentReferenceLookupStarted = false;
  let paymentReferenceLookupCompleted = false;
  let paymentReferenceCandidateBlocked = false;
  try {
    const credentials = await loadDecryptedAsaasCredentials(pending.map.contaId);
    if (!credentials?.apiKey) {
      throw new EventsError(
        'ASAAS_NAO_CONFIGURADO',
        'A integração de pagamentos não está configurada para vender ingressos. Fale com a instituição.',
        409,
      );
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
    paymentReferenceLookupStarted = true;
    let remotePayments: EventAsaasPayment[];
    try {
      remotePayments = await listCompleteEventPaymentsByReference({
        apiKey: credentials.apiKey,
        externalReference,
      });
    } catch (error) {
      paymentReferenceCandidateBlocked = true;
      await markEventMapPaymentReconciliationRequired({
        contaId: pending.map.contaId,
        orderId: pending.order.id,
        expectedPaymentStatus: pending.order.paymentStatus,
        externalReference,
        reason: 'REFERENCE_LOOKUP_INCOMPLETE',
        metadata: { lookupError: error instanceof Error ? error.message : String(error) },
      });
      throw new EventsError(
        'PAGAMENTO_EM_VERIFICACAO',
        'Estamos verificando a cobrança com o provedor. Consulte o pedido novamente em instantes.',
        409,
      );
    }
    paymentReferenceLookupCompleted = true;
    let existingPayment: EventAsaasPayment | null;
    try {
      existingPayment = selectUniqueActiveEventPayment(remotePayments);
    } catch {
      paymentReferenceCandidateBlocked = true;
      await markEventMapPaymentReconciliationRequired({
        contaId: pending.map.contaId,
        orderId: pending.order.id,
        expectedPaymentStatus: pending.order.paymentStatus,
        externalReference,
        reason: 'MULTIPLE_REMOTE_PAYMENTS',
        metadata: { lookupStatus: 'COMPLETE' },
      });
      throw new EventsError(
        'COBRANCAS_DUPLICADAS_EM_RECONCILIACAO',
        'Encontramos mais de uma cobrança para este pedido. A equipe da instituição precisa verificar antes de continuar.',
        409,
      );
    }
    if (existingPayment) {
      const expectedValue = toMoney(pending.totalAmount);
      const remoteValue =
        typeof existingPayment.value === 'number' ? toMoney(existingPayment.value) : null;
      const currentOrder = await prisma.eventMapOrder.findFirst({
        where: { id: pending.order.id, contaId: pending.map.contaId },
        select: { asaasCustomerId: true },
      });
      let buyerCustomerId: string;
      try {
        buyerCustomerId = await requireBuyerAsaasCustomerId({
          apiKey: credentials.apiKey,
          buyerDocument,
          localCustomerId: currentOrder?.asaasCustomerId,
        });
      } catch (error) {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: pending.order.paymentStatus,
          externalReference,
          reason: 'BUYER_CUSTOMER_NOT_CONFIRMED',
          metadata: { lookupError: error instanceof Error ? error.message : String(error) },
        });
        throw new EventsError(
          'COBRANCA_DIVERGENTE_EM_RECONCILIACAO',
          'Não foi possível confirmar o vínculo da cobrança com o comprador. A equipe da instituição precisa verificar.',
          409,
        );
      }
      if (
        remoteValue !== expectedValue ||
        existingPayment.billingType !== input.paymentMethod ||
        existingPayment.customer !== buyerCustomerId
      ) {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: pending.order.paymentStatus,
          externalReference,
          reason: 'PAYMENT_MISMATCH',
          metadata: {
            lookupStatus: 'COMPLETE',
            paymentId: existingPayment.id,
            customerIdMatched: existingPayment.customer === buyerCustomerId,
          },
        });
        throw new EventsError(
          'COBRANCA_DIVERGENTE_EM_RECONCILIACAO',
          'A cobrança encontrada não corresponde aos dados desta compra e precisa de verificação antes de continuar.',
          409,
        );
      }
      const attached = await prisma.eventMapOrder.updateMany({
        where: {
          id: pending.order.id,
          contaId: pending.map.contaId,
          status: 'PAYMENT_PENDING',
          asaasPaymentId: null,
          paymentStatus: pending.order.paymentStatus,
        },
        data: {
          asaasPaymentId: existingPayment.id,
          paymentStatus: existingPayment.status ?? 'PENDING',
          paymentProvider: 'ASAAS',
          invoiceUrl: existingPayment.invoiceUrl ?? null,
        },
      });
      const reconciledOrder = await prisma.eventMapOrder.findFirst({
        where: { id: pending.order.id, contaId: pending.map.contaId },
        include: { items: { include: { ticket: true } } },
      });
      if (!reconciledOrder) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado após reconciliar a cobrança.', 404);
      if (attached.count !== 1 && reconciledOrder.asaasPaymentId !== existingPayment.id) {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: pending.order.paymentStatus,
          externalReference,
          reason: 'LOCAL_ORDER_PAYMENT_CONFLICT',
          metadata: {
            lookupStatus: 'COMPLETE',
            remotePaymentId: existingPayment.id,
            localPaymentId: reconciledOrder.asaasPaymentId,
          },
        });
        throw new EventsError(
          'PAGAMENTO_EM_VERIFICACAO',
          'O pedido foi atualizado durante a reconciliação da cobrança. Consulte o pedido novamente.',
          409,
        );
      }
      return buildCheckoutResponse(reconciledOrder, {
        apiKey: credentials.apiKey,
        paymentMethod: input.paymentMethod,
        publicSlug: pending.map.publicSlug,
      });
    }

    if (
      pending.order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' ||
      pending.order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN'
    ) {
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

    const existingCustomers = await listCompleteEventCustomersByDocument({
      apiKey: credentials.apiKey,
      cpfCnpj: buyerDocument,
    });
    const activeCustomers = existingCustomers.filter((customer) => !customer.deleted);
    if (activeCustomers.length > 1) {
      paymentReferenceCandidateBlocked = true;
      await markEventMapPaymentReconciliationRequired({
        contaId: pending.map.contaId,
        orderId: pending.order.id,
        expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
        externalReference,
        reason: 'DUPLICATE_BUYER_CUSTOMERS',
        metadata: { customerIds: activeCustomers.map((customer) => customer.id) },
      });
      throw new EventsError(
        'COMPRADOR_DUPLICADO_EM_RECONCILIACAO',
        'Encontramos mais de um cadastro para o comprador. A equipe da instituição precisa verificar antes de continuar.',
        409,
      );
    }
    const activeCustomer = activeCustomers[0];
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
        throw new EventsError(
          'PAGAMENTO_EM_VERIFICACAO',
          'A tentativa de cobrança foi assumida por outra requisição.',
          409,
        );
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
      if (
        !payment?.id?.trim() ||
        payment.externalReference !== externalReference ||
        typeof payment.value !== 'number' ||
        !Number.isFinite(payment.value) ||
        toMoney(payment.value) !== toMoney(pending.totalAmount) ||
        payment.billingType !== input.paymentMethod ||
        payment.customer !== customerId
      ) {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_UNKNOWN',
          externalReference,
          reason: 'POST_RESPONSE_MISMATCH',
          metadata: {
            paymentId: payment?.id ?? null,
            referenceMatched: payment?.externalReference === externalReference,
            valueMatched: typeof payment?.value === 'number' && toMoney(payment.value) === toMoney(pending.totalAmount),
            billingTypeMatched: payment?.billingType === input.paymentMethod,
            customerMatched: payment?.customer === customerId,
          },
        });
        throw new EventsError(
          'COBRANCA_DIVERGENTE_EM_RECONCILIACAO',
          'A cobrança retornada pelo provedor não corresponde ao pedido e precisa de verificação.',
          409,
        );
      }
    } catch (paymentError) {
      if (
        paymentError instanceof EventsError &&
        paymentError.code === 'COBRANCA_DIVERGENTE_EM_RECONCILIACAO'
      ) {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_UNKNOWN',
          externalReference,
          reason: 'POST_RESPONSE_PAYMENT_MISMATCH',
          metadata: { lookupStatus: 'POST_RESPONSE' },
        });
        throw paymentError;
      }
      let postFailureLookupCompleted = false;
      try {
        const reconciled = await listCompleteEventPaymentsByReference({
          apiKey: credentials.apiKey,
          externalReference,
        });
        postFailureLookupCompleted = true;
        let recovered: EventAsaasPayment | null;
        try {
          recovered = selectUniqueActiveEventPayment(reconciled);
        } catch {
          throw new EventsError(
            'COBRANCAS_DUPLICADAS_EM_RECONCILIACAO',
            'Encontramos mais de uma cobrança para este pedido. A equipe da instituição precisa verificar antes de continuar.',
            409,
          );
        }
        if (!recovered) throw paymentError;
        const expectedValue = toMoney(pending.totalAmount);
        const remoteValue = typeof recovered.value === 'number' ? toMoney(recovered.value) : null;
        if (
          remoteValue !== expectedValue ||
          recovered.billingType !== input.paymentMethod ||
          recovered.customer !== customerId
        ) {
          throw new EventsError(
            'COBRANCA_DIVERGENTE_EM_RECONCILIACAO',
            'A cobrança encontrada não corresponde aos dados desta compra e precisa de verificação antes de continuar.',
            409,
          );
        }
        payment = recovered;
      } catch (listError) {
        const reconciliationError = listError instanceof EventsError ? listError : null;
        const reason = reconciliationError?.code === 'COBRANCAS_DUPLICADAS_EM_RECONCILIACAO'
          ? 'POST_RESPONSE_MULTIPLE_PAYMENTS'
          : reconciliationError?.code === 'COBRANCA_DIVERGENTE_EM_RECONCILIACAO'
            ? 'POST_RESPONSE_PAYMENT_MISMATCH'
            : postFailureLookupCompleted && listError === paymentError
              ? 'POST_RESPONSE_PAYMENT_NOT_FOUND'
              : 'POST_RESPONSE_LOOKUP_INCOMPLETE';
        const lookupStatus = reason === 'POST_RESPONSE_MULTIPLE_PAYMENTS'
          ? 'MULTIPLE'
          : reason === 'POST_RESPONSE_PAYMENT_MISMATCH'
            ? 'MISMATCH'
            : reason === 'POST_RESPONSE_PAYMENT_NOT_FOUND'
              ? 'COMPLETE_NO_MATCH'
              : 'INCOMPLETE';
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_UNKNOWN',
          externalReference,
          reason,
          metadata: { lookupStatus },
        });
        logEventsFinance(
          'finance.events.public_event_map.checkout.payment_reconciliation.failed',
          { error: listError },
          'warn',
        );
        throw listError;
      }
    }

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
    if (!updated)
      throw new EventsError(
        'PEDIDO_NAO_ENCONTRADO',
        'Pedido não encontrado após criar a cobrança.',
        404,
      );

    if (
      attached.count !== 1 &&
      updated.asaasPaymentId !== payment.id &&
      !['EXPIRED', 'CANCELLED'].includes(updated.status)
    ) {
      paymentReferenceCandidateBlocked = true;
      await markEventMapPaymentReconciliationRequired({
        contaId: pending.map.contaId,
        orderId: pending.order.id,
        expectedPaymentStatus: 'PAYMENT_CREATION_UNKNOWN',
        externalReference,
        reason: 'POST_ATTACH_CONFLICT',
        metadata: { remotePaymentId: payment.id, localPaymentId: updated.asaasPaymentId },
      });
      throw new EventsError(
        'PAGAMENTO_EM_VERIFICACAO',
        'O pedido foi atualizado durante a criação da cobrança. Consulte o pedido novamente.',
        409,
      );
    }

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
          paidAt:
            parseFirstValidCivilDatePreservingInstant(
              payment.paymentDate,
              payment.clientPaymentDate,
            ) ?? new Date(),
          paidAmount: payment.value ?? null,
          allowReleasedReservation: true,
        };
        const confirmed = await confirmPublicEventMapOrderPayment(latePaymentParams).catch(
          () => null,
        );
        if (!confirmed) {
          await reconcileEventMapOrderFinancialStateFromAsaas({
            ...latePaymentParams,
            ticketFulfillmentError: 'PAYMENT_CREATED_AFTER_RESERVATION_EXPIRED',
          });
        }
      } else if (!payment.deleted && CANCELLABLE_ASAAS_PAYMENT_STATUSES.has(paymentStatus)) {
        await getEventAsaasPaymentProvider()
          .deletePayment({ apiKey: credentials.apiKey, paymentId: payment.id })
          .catch((deleteError) => {
            logEventsFinance(
              'finance.events.public_event_map.checkout.late_payment_cancel.failed',
              { error: deleteError },
              'error',
            );
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
        eventName: `${pending.map.event.name} · ${pending.map.name}`,
        eventStartsAt: pending.publishedMapSchedule.startsAt
          ? new Date(pending.publishedMapSchedule.startsAt)
          : pending.map.startsAt ?? pending.map.event.startsAt,
        eventStartsAtLocal: pending.publishedMapSchedule.startsAtLocal,
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
    const currentOrder = await prisma.eventMapOrder.findFirst({
      where: { id: pending.order.id, contaId: pending.map.contaId },
      select: { asaasPaymentId: true, paymentStatus: true },
    });
    const unresolvedPaymentCreation =
      currentOrder?.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' ||
      currentOrder?.paymentStatus === 'PAYMENT_CREATION_UNKNOWN';
    if (
      !currentOrder?.asaasPaymentId &&
      !unresolvedPaymentCreation &&
      !paymentCreationClaimed &&
      !paymentCreationStarted &&
      (!paymentReferenceLookupStarted ||
        (paymentReferenceLookupCompleted && !paymentReferenceCandidateBlocked))
    ) {
      await cancelPublicEventMapOrder(
        pending.map.contaId,
        pending.order.id,
        'Falha ao gerar a cobrança.',
      );
    }
    throw error;
  }
}

export type PublicCheckoutDTO = Awaited<ReturnType<typeof completePublicEventMapCheckout>>;
