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
  listCompleteEventCustomersByReference,
  selectUniqueActiveEventPayment,
  type EventAsaasCustomer,
  type EventAsaasPayment,
} from './event-asaas-payment-provider';
import { EventsError } from '@alusa/domain/events';
import { loadDecryptedAsaasCredentials } from '../foundation/load-decrypted-asaas-credentials';
import { parseFirstValidCivilDatePreservingInstant } from '../mappers/civil-date';
import { logEventsFinance } from './events-finance-observability';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
import { findCustomerForPayer } from '../customer/customer-identity';
import { withSessionAdvisoryLock } from '../core/idempotency.service';
import { resolveMonotonicAsaasPaymentStatus } from '../mappers/asaas-snapshot-monotonicity';

const PAID_ASAAS_PAYMENT_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);
const CANCELLABLE_ASAAS_PAYMENT_STATUSES = new Set(['PENDING', 'OVERDUE']);
// AsaasHttp caps a single POST request at 60 seconds and does not retry
// mutating requests. Leave three times that window before recovering a process
// that may still be handling the response. UNKNOWN remains immediately eligible.
const CUSTOMER_CREATION_IN_PROGRESS_STALE_AFTER_MS = 3 * 60_000;

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
  contaId: string;
  buyerDocument: string;
  localCustomerId?: string | null;
}) {
  const customers = await listCompleteEventCustomersByDocument({
    apiKey: input.apiKey,
    cpfCnpj: input.buyerDocument,
  });
  const matches = customers.filter((customer) => !customer.deleted);
  const responsibles = await prisma.responsavel.findMany({
    where: { contaId: input.contaId, cpf: input.buyerDocument },
    select: { id: true, asaasCustomerId: true },
  });
  if (responsibles.length > 1) throw new Error('BUYER_ASAAS_CUSTOMER_NOT_UNIQUELY_CONFIRMED');
  const responsible = responsibles[0];
  const identity = responsible
    ? await findCustomerForPayer(input.contaId, 'RESPONSAVEL', responsible.id)
    : null;
  const legacyCustomerId = responsible?.asaasCustomerId ?? null;
  const canonicalCustomerId = identity?.asaasCustomerId ?? null;
  if (legacyCustomerId && canonicalCustomerId && legacyCustomerId !== canonicalCustomerId) {
    throw new Error('BUYER_ASAAS_CUSTOMER_IDENTITY_CONFLICT');
  }
  const linkedCustomerIds = [...new Set([
    input.localCustomerId,
    canonicalCustomerId,
    legacyCustomerId,
  ].filter((id): id is string => Boolean(id)))];
  if (linkedCustomerIds.length > 1) throw new Error('BUYER_ASAAS_CUSTOMER_IDENTITY_CONFLICT');
  const canonicalMatches = matches.filter((customer) => linkedCustomerIds.includes(customer.id));
  if (!matches.length) {
    if (input.localCustomerId || linkedCustomerIds.length > 0) {
      throw new Error('BUYER_ASAAS_CUSTOMER_LINK_NOT_FOUND');
    }
    return null;
  }
  if (
    !matches.every((customer) => customer.id) ||
    (linkedCustomerIds.length > 0 && canonicalMatches.length !== 1) ||
    (matches.length > 1 && canonicalMatches.length !== 1)
  ) {
    throw new Error('BUYER_ASAAS_CUSTOMER_NOT_UNIQUELY_CONFIRMED');
  }
  return (canonicalMatches[0] ?? matches[0]).id;
}

async function markEventMapPaymentReconciliationRequired(input: {
  contaId: string;
  orderId: string;
  expectedPaymentStatus: string | null;
  externalReference: string;
  reason: string;
  metadata?: Prisma.InputJsonObject;
  operation?: 'CUSTOMER_CREATION' | 'PAYMENT_CREATION';
}) {
  const operation = input.operation ?? 'PAYMENT_CREATION';
  const priorIssue = await prisma.financeReconciliationIssue.findFirst({
    where: {
      contaId: input.contaId,
      entityType: 'PAYMENT',
      entityId: input.orderId,
      issueType: 'BILLING_OPERATION_UNCERTAIN',
    },
    select: { metadata: true },
  });
  const priorMetadata = priorIssue?.metadata;
  const priorCustomerCreationAttempt =
    operation === 'PAYMENT_CREATION' &&
    priorMetadata !== null &&
    typeof priorMetadata === 'object' &&
    !Array.isArray(priorMetadata) &&
    priorMetadata.operation === 'CUSTOMER_CREATION' &&
    priorMetadata.customerCreationPostStarted === true &&
    priorMetadata.externalReference === input.externalReference;
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
      operation,
      customerCreationPostStarted: operation === 'CUSTOMER_CREATION',
      ...(priorCustomerCreationAttempt
        ? { previousCustomerCreationAttempt: { postStarted: true, externalReference: input.externalReference, resolvedBeforePayment: true } }
        : {}),
    },
  });
}

export async function recordFailedEventMapPaymentCancellation(input: {
  contaId: string;
  orderId: string;
  paymentId: string;
  orderStatus: 'CANCELLED' | 'EXPIRED';
  apiKey: string;
  paymentStatus: string;
  error: unknown;
}) {
  const errorCode = input.error && typeof input.error === 'object' && 'code' in input.error
    && typeof input.error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(input.error.code)
    ? input.error.code
    : input.error instanceof Error ? input.error.name : 'UNKNOWN_ERROR';
  let latestRemoteStatus = input.paymentStatus;
  let remoteReadSucceeded = false;
  let latestPayment: EventAsaasPayment | null = null;
  try {
    const latest = await getEventAsaasPaymentProvider().getPayment({ apiKey: input.apiKey, paymentId: input.paymentId });
    if (latest.id === input.paymentId) {
      latestPayment = latest;
      latestRemoteStatus = latest.deleted ? 'DELETED' : latest.status?.trim().toUpperCase() ?? latestRemoteStatus;
      remoteReadSucceeded = true;
    }
  } catch (error) {
    logEventsFinance('finance.events.public_event_map.checkout.payment_reconciliation.failed', { error }, 'warn');
  }

  // A restore can be observed while DELETE is in flight, after the first GET.
  // Re-read after observing that marker so a pre-restore snapshot cannot mask
  // a payment received during the cancellation window.
  let restoreObservedBeforeMerge = false;
  let paidIssueObservedBeforeMerge = false;
  await withSessionAdvisoryLock({
    contaId: input.contaId,
    scope: 'webhook-process',
    key: `payment:${input.paymentId}`,
    fn: async () => {
      const issue = await prisma.financeReconciliationIssue.findFirst({
        where: { contaId: input.contaId, dedupeKey: `PAYMENT_NEEDS_REVIEW:PAYMENT:${input.orderId}`, status: 'OPEN' },
        select: { metadata: true, remoteStatus: true },
      });
      const metadata = issue?.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
        ? issue.metadata as Record<string, unknown>
        : null;
      restoreObservedBeforeMerge = metadata?.cancellationRestoreObserved === true;
      paidIssueObservedBeforeMerge = PAID_ASAAS_PAYMENT_STATUSES.has(issue?.remoteStatus?.trim().toUpperCase() ?? '');
    },
  });
  let postRestoreReadSucceeded = false;
  if (restoreObservedBeforeMerge || paidIssueObservedBeforeMerge && !PAID_ASAAS_PAYMENT_STATUSES.has(latestRemoteStatus) && latestRemoteStatus !== 'DELETED') {
    try {
      const latest = await getEventAsaasPaymentProvider().getPayment({ apiKey: input.apiKey, paymentId: input.paymentId });
      if (latest.id === input.paymentId) {
        latestPayment = latest;
        latestRemoteStatus = latest.deleted ? 'DELETED' : latest.status?.trim().toUpperCase() ?? latestRemoteStatus;
        remoteReadSucceeded = latest.deleted === true || Boolean(latest.status);
        postRestoreReadSucceeded = remoteReadSucceeded;
      }
    } catch (error) {
      logEventsFinance('finance.events.public_event_map.checkout.payment_reconciliation.failed', { error }, 'warn');
    }
  }

  const finalState = await withSessionAdvisoryLock({
    contaId: input.contaId,
    scope: 'webhook-process',
    key: `payment:${input.paymentId}`,
    fn: async () => {
      const current = await prisma.eventMapOrder.findFirst({
        where: { id: input.orderId, contaId: input.contaId, status: input.orderStatus, asaasPaymentId: input.paymentId },
        select: { id: true, status: true, paymentStatus: true },
      });
      if (!current) return null;
      const issue = await prisma.financeReconciliationIssue.findFirst({
        where: { contaId: input.contaId, dedupeKey: `PAYMENT_NEEDS_REVIEW:PAYMENT:${input.orderId}`, status: 'OPEN' },
        select: { remoteStatus: true, metadata: true },
      });
      const issueStatus = issue?.remoteStatus?.trim().toUpperCase() ?? null;
      const issueMetadata = issue?.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
        ? issue.metadata as Record<string, unknown>
        : null;
      const restoreObserved = issueMetadata?.cancellationRestoreObserved === true;
      const paidIssueObserved = PAID_ASAAS_PAYMENT_STATUSES.has(issueStatus ?? '');
      const currentStatus = current.paymentStatus?.trim().toUpperCase() ?? null;
      const resolvedStatus = restoreObserved
        ? postRestoreReadSucceeded ? latestRemoteStatus : 'CANCELLATION_IN_PROGRESS'
        : remoteReadSucceeded && latestRemoteStatus === 'DELETED' ? 'DELETED'
        : currentStatus === 'DELETED' || issueStatus === 'DELETED'
        ? 'DELETED'
        : PAID_ASAAS_PAYMENT_STATUSES.has(issueStatus ?? '')
          ? issueStatus!
          : remoteReadSucceeded ? latestRemoteStatus : 'CANCELLATION_IN_PROGRESS';
      await prisma.eventMapOrder.updateMany({
        where: { id: current.id, contaId: input.contaId, status: input.orderStatus, asaasPaymentId: input.paymentId, paymentStatus: current.paymentStatus },
        data: { paymentStatus: resolvedStatus },
      });
      const persisted = await prisma.eventMapOrder.findFirst({
        where: { id: current.id, contaId: input.contaId, status: input.orderStatus, asaasPaymentId: input.paymentId },
        select: { status: true, paymentStatus: true },
      });
      const result = persisted ? { status: persisted.status, paymentStatus: persisted.paymentStatus?.trim().toUpperCase() ?? resolvedStatus } : null;
      if (result?.paymentStatus === 'DELETED' && !paidIssueObserved && (!restoreObserved || postRestoreReadSucceeded && latestRemoteStatus === 'DELETED')) {
        await prisma.financeReconciliationIssue.updateMany({
          where: { contaId: input.contaId, dedupeKey: `PAYMENT_NEEDS_REVIEW:PAYMENT:${input.orderId}`, status: 'OPEN' },
          data: { status: 'RESOLVED', remoteStatus: 'DELETED', resolvedAt: new Date(), resolution: 'Asaas payment cancellation confirmed by provider lookup.' },
        });
      } else if (result) await upsertFinanceReconciliationIssue({
        contaId: input.contaId,
        entityType: 'PAYMENT',
        entityId: input.orderId,
        asaasId: input.paymentId,
        issueType: 'PAYMENT_NEEDS_REVIEW',
        severity: 'HIGH',
        localStatus: result.status,
        remoteStatus: paidIssueObserved ? issueStatus! : result.paymentStatus,
        causeId: `payment-post-delete:${input.paymentId}`,
        metadata: {
          source: 'public-event-map-checkout',
          reason: paidIssueObserved ? 'payment_received_during_order_cancellation'
            : restoreObserved ? 'payment_restored_during_order_cancellation' : 'cancelled_order_payment_delete_failed',
          eventMapOrderId: input.orderId,
          orderStatus: input.orderStatus,
          paymentStatus: result.paymentStatus,
          cancellationInProgress: restoreObserved && !postRestoreReadSucceeded || (!remoteReadSucceeded && !PAID_ASAAS_PAYMENT_STATUSES.has(result.paymentStatus)),
          seatsMustNotBeReopenedAutomatically: true,
          deleteErrorCode: errorCode,
        },
      });
      return result;
    },
  });
  if (!finalState) return { latePaymentFulfilled: false };
  let latePaymentFulfilled = false;
  if (input.orderStatus === 'EXPIRED' && remoteReadSucceeded && PAID_ASAAS_PAYMENT_STATUSES.has(latestRemoteStatus) && PAID_ASAAS_PAYMENT_STATUSES.has(finalState.paymentStatus)) {
    if (!latestPayment) latestPayment = await getEventAsaasPaymentProvider().getPayment({ apiKey: input.apiKey, paymentId: input.paymentId }).catch(() => null);
    const confirmed = await confirmPublicEventMapOrderPayment({
      contaId: input.contaId,
      asaasPaymentId: input.paymentId,
      paymentStatus: finalState.paymentStatus,
      invoiceUrl: latestPayment?.invoiceUrl ?? null,
      paidAt: parseFirstValidCivilDatePreservingInstant(latestPayment?.paymentDate, latestPayment?.clientPaymentDate) ?? new Date(),
      paidAmount: latestPayment?.value ?? null,
      allowReleasedReservation: true,
    }).catch(() => null);
    latePaymentFulfilled = Boolean(confirmed);
    if (!confirmed) await reconcileEventMapOrderFinancialStateFromAsaas({
        contaId: input.contaId,
        asaasPaymentId: input.paymentId,
        paymentStatus: finalState.paymentStatus,
        invoiceUrl: latestPayment?.invoiceUrl ?? null,
        paidAt: parseFirstValidCivilDatePreservingInstant(latestPayment?.paymentDate, latestPayment?.clientPaymentDate) ?? new Date(),
        paidAmount: latestPayment?.value ?? null,
        ticketFulfillmentError: 'PAYMENT_RECEIVED_DURING_CANCELLATION',
      });
  }
  return { latePaymentFulfilled };
}

export async function beginEventMapPaymentCancellation(input: {
  contaId: string;
  orderId: string;
  paymentId: string;
  orderStatus: 'CANCELLED' | 'EXPIRED';
}) {
  return withSessionAdvisoryLock({
    contaId: input.contaId,
    scope: 'webhook-process',
    key: `payment:${input.paymentId}`,
    fn: async () => {
      const current = await prisma.eventMapOrder.findFirst({
        where: { id: input.orderId, contaId: input.contaId, status: input.orderStatus, asaasPaymentId: input.paymentId },
        select: { id: true, status: true, paymentStatus: true },
      });
      const currentPaymentStatus = current?.paymentStatus?.trim().toUpperCase() ?? null;
      if (!current || !['PENDING', 'OVERDUE'].includes(currentPaymentStatus ?? '')) return false;
      const claimed = await prisma.eventMapOrder.updateMany({
        where: { id: current.id, contaId: input.contaId, status: input.orderStatus, asaasPaymentId: input.paymentId, paymentStatus: current.paymentStatus },
        data: { paymentStatus: 'CANCELLATION_IN_PROGRESS' },
      });
      if (claimed.count !== 1) return false;
      await upsertFinanceReconciliationIssue({
        contaId: input.contaId,
        entityType: 'PAYMENT',
        entityId: input.orderId,
        asaasId: input.paymentId,
        issueType: 'PAYMENT_NEEDS_REVIEW',
        severity: 'HIGH',
        localStatus: input.orderStatus,
        remoteStatus: 'CANCELLATION_IN_PROGRESS',
        causeId: `payment-post-delete:${input.paymentId}`,
        metadata: {
          source: 'public-event-map-checkout',
          reason: 'cancelled_order_payment_delete_in_progress',
          eventMapOrderId: input.orderId,
          orderStatus: input.orderStatus,
          cancellationInProgress: true,
          seatsMustNotBeReopenedAutomatically: true,
        },
      });
      return true;
    },
  });
}

export async function recordSuccessfulEventMapPaymentCancellation(input: {
  contaId: string;
  orderId: string;
  paymentId: string;
  orderStatus: 'CANCELLED' | 'EXPIRED';
  apiKey: string;
  remoteStatus: string | null;
}) {
  const responseStatus = input.remoteStatus?.trim().toUpperCase() ?? null;
  let finalRemoteStatus = responseStatus;
  let latestRemoteStatus: string | null = null;
  let remoteReadSucceeded = false;
  let latestPayment: EventAsaasPayment | null = null;
  try {
    const latest = await getEventAsaasPaymentProvider().getPayment({ apiKey: input.apiKey, paymentId: input.paymentId });
    if (latest.id === input.paymentId) {
      latestPayment = latest;
      latestRemoteStatus = latest.deleted ? 'DELETED' : latest.status?.trim().toUpperCase() ?? null;
      remoteReadSucceeded = latest.deleted === true || Boolean(latest.status);
    }
    const latestStatus = latest.id === input.paymentId
      ? latest.deleted ? 'DELETED' : latest.status?.trim().toUpperCase() ?? null
      : null;
    const paidObservation = [latestStatus, responseStatus].find((status) => PAID_ASAAS_PAYMENT_STATUSES.has(status ?? ''));
    finalRemoteStatus = responseStatus === 'DELETED'
      ? 'DELETED'
      : paidObservation ?? latestStatus ?? responseStatus;
  } catch {
    // Keep the DELETE response as evidence; without a terminal response or
    // readable snapshot, the durable intent stays open for reconciliation.
  }
  let restoreObservedBeforeMerge = false;
  let paidIssueObservedBeforeMerge = false;
  await withSessionAdvisoryLock({
    contaId: input.contaId,
    scope: 'webhook-process',
    key: `payment:${input.paymentId}`,
    fn: async () => {
      const issue = await prisma.financeReconciliationIssue.findFirst({
        where: { contaId: input.contaId, dedupeKey: `PAYMENT_NEEDS_REVIEW:PAYMENT:${input.orderId}`, status: 'OPEN' },
        select: { metadata: true, remoteStatus: true },
      });
      const metadata = issue?.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
        ? issue.metadata as Record<string, unknown>
        : null;
      restoreObservedBeforeMerge = metadata?.cancellationRestoreObserved === true;
      paidIssueObservedBeforeMerge = PAID_ASAAS_PAYMENT_STATUSES.has(issue?.remoteStatus?.trim().toUpperCase() ?? '');
    },
  });
  let postRestoreReadSucceeded = false;
  if (restoreObservedBeforeMerge || paidIssueObservedBeforeMerge && !PAID_ASAAS_PAYMENT_STATUSES.has(latestRemoteStatus ?? '') && latestRemoteStatus !== 'DELETED') {
    try {
      const latest = await getEventAsaasPaymentProvider().getPayment({ apiKey: input.apiKey, paymentId: input.paymentId });
      if (latest.id === input.paymentId) {
        latestPayment = latest;
        latestRemoteStatus = latest.deleted ? 'DELETED' : latest.status?.trim().toUpperCase() ?? null;
        remoteReadSucceeded = latest.deleted === true || Boolean(latest.status);
        postRestoreReadSucceeded = remoteReadSucceeded;
        if (latestRemoteStatus && PAID_ASAAS_PAYMENT_STATUSES.has(latestRemoteStatus)) finalRemoteStatus = latestRemoteStatus;
        else if (latestRemoteStatus) finalRemoteStatus = latestRemoteStatus;
        if (responseStatus === 'DELETED') finalRemoteStatus = 'DELETED';
      }
    } catch {
      // Preserve the open cancellation issue when a post-restore read is ambiguous.
    }
  }
  const finalState = await withSessionAdvisoryLock({
    contaId: input.contaId,
    scope: 'webhook-process',
    key: `payment:${input.paymentId}`,
    fn: async () => {
      const current = await prisma.eventMapOrder.findFirst({
        where: { id: input.orderId, contaId: input.contaId, status: input.orderStatus, asaasPaymentId: input.paymentId },
        select: { id: true, paymentStatus: true },
      });
      if (!current) return null;
      const currentStatus = current.paymentStatus?.trim().toUpperCase() ?? null;
      const issue = await prisma.financeReconciliationIssue.findFirst({
        where: { contaId: input.contaId, dedupeKey: `PAYMENT_NEEDS_REVIEW:PAYMENT:${input.orderId}`, status: 'OPEN' },
        select: { remoteStatus: true, metadata: true },
      });
      const issueStatus = issue?.remoteStatus?.trim().toUpperCase() ?? null;
      const receivedDuringCancellation = PAID_ASAAS_PAYMENT_STATUSES.has(issueStatus ?? '');
      const issueMetadata = issue?.metadata && typeof issue.metadata === 'object' && !Array.isArray(issue.metadata)
        ? issue.metadata as Record<string, unknown>
        : null;
      const restoreObserved = issueMetadata?.cancellationRestoreObserved === true;
      const paidIssueObserved = PAID_ASAAS_PAYMENT_STATUSES.has(issueStatus ?? '');
      const resolvedStatus = restoreObserved
        ? responseStatus === 'DELETED' ? 'DELETED'
          : postRestoreReadSucceeded ? latestRemoteStatus ?? 'CANCELLATION_IN_PROGRESS' : 'CANCELLATION_IN_PROGRESS'
        : remoteReadSucceeded && latestRemoteStatus === 'DELETED' || responseStatus === 'DELETED' ? 'DELETED'
        : currentStatus === 'DELETED' || issueStatus === 'DELETED'
        ? 'DELETED'
        : receivedDuringCancellation
          ? issueStatus!
        : PAID_ASAAS_PAYMENT_STATUSES.has(currentStatus ?? '') ? currentStatus!
          : PAID_ASAAS_PAYMENT_STATUSES.has(finalRemoteStatus ?? '') ? finalRemoteStatus!
            : finalRemoteStatus === 'DELETED' ? 'DELETED' : 'CANCELLATION_IN_PROGRESS';
      await prisma.eventMapOrder.updateMany({
        where: { id: current.id, contaId: input.contaId, status: input.orderStatus, asaasPaymentId: input.paymentId, paymentStatus: current.paymentStatus },
        data: { paymentStatus: resolvedStatus },
      });
      const persisted = await prisma.eventMapOrder.findFirst({
        where: { id: current.id, contaId: input.contaId, status: input.orderStatus, asaasPaymentId: input.paymentId },
        select: { status: true, paymentStatus: true },
      });
      const result = persisted ? { status: persisted.status, paymentStatus: persisted.paymentStatus?.trim().toUpperCase() ?? resolvedStatus } : null;
      if (result && result.paymentStatus === 'DELETED' && !paidIssueObserved && (!restoreObserved || postRestoreReadSucceeded && latestRemoteStatus === 'DELETED')) {
        await prisma.financeReconciliationIssue.updateMany({
          where: { contaId: input.contaId, dedupeKey: `PAYMENT_NEEDS_REVIEW:PAYMENT:${input.orderId}`, status: 'OPEN' },
          data: { status: 'RESOLVED', remoteStatus: 'DELETED', resolvedAt: new Date(), resolution: 'Asaas payment cancellation completed.' },
        });
      } else if (result) {
        await upsertFinanceReconciliationIssue({
          contaId: input.contaId,
          entityType: 'PAYMENT',
          entityId: input.orderId,
          asaasId: input.paymentId,
          issueType: 'PAYMENT_NEEDS_REVIEW',
          severity: 'HIGH',
          localStatus: result.status,
          remoteStatus: paidIssueObserved ? issueStatus!
            : restoreObserved && postRestoreReadSucceeded ? latestRemoteStatus ?? result.paymentStatus
            : restoreObserved ? result.paymentStatus
            : PAID_ASAAS_PAYMENT_STATUSES.has(result.paymentStatus) ? result.paymentStatus : finalRemoteStatus ?? 'CANCELLATION_IN_PROGRESS',
          causeId: `payment-post-delete:${input.paymentId}`,
          metadata: {
            source: 'public-event-map-checkout',
            reason: paidIssueObserved ? 'payment_received_during_order_cancellation'
              : restoreObserved ? 'payment_restored_during_order_cancellation'
              : PAID_ASAAS_PAYMENT_STATUSES.has(result.paymentStatus) ? 'payment_received_during_order_cancellation' : 'payment_cancellation_unconfirmed',
            eventMapOrderId: input.orderId,
            orderStatus: input.orderStatus,
            cancellationInProgress: restoreObserved && !postRestoreReadSucceeded || (!PAID_ASAAS_PAYMENT_STATUSES.has(result.paymentStatus) && finalRemoteStatus !== 'DELETED'),
            paymentStatus: result.paymentStatus,
            seatsMustNotBeReopenedAutomatically: true,
          },
        });
      }
      return result;
    },
  });
  if (!finalState) return { latePaymentFulfilled: false };
  if (input.orderStatus === 'EXPIRED' && responseStatus !== 'DELETED' && remoteReadSucceeded && PAID_ASAAS_PAYMENT_STATUSES.has(latestRemoteStatus ?? '') && PAID_ASAAS_PAYMENT_STATUSES.has(finalState.paymentStatus)) {
    if (!latestPayment && finalRemoteStatus && PAID_ASAAS_PAYMENT_STATUSES.has(finalRemoteStatus)) {
      latestPayment = await getEventAsaasPaymentProvider().getPayment({ apiKey: input.apiKey, paymentId: input.paymentId }).catch(() => null);
    }
    const paidAt = parseFirstValidCivilDatePreservingInstant(latestPayment?.paymentDate, latestPayment?.clientPaymentDate) ?? new Date();
    const paidAmount = latestPayment?.value ?? null;
    const confirmed = await confirmPublicEventMapOrderPayment({
      contaId: input.contaId,
      asaasPaymentId: input.paymentId,
      paymentStatus: finalState.paymentStatus,
      invoiceUrl: latestPayment?.invoiceUrl ?? null,
      paidAt,
      paidAmount,
      allowReleasedReservation: true,
    }).catch(() => null);
    if (!confirmed) await reconcileEventMapOrderFinancialStateFromAsaas({
      contaId: input.contaId,
      asaasPaymentId: input.paymentId,
      paymentStatus: finalState.paymentStatus,
      invoiceUrl: latestPayment?.invoiceUrl ?? null,
      paidAt,
      paidAmount,
      ticketFulfillmentError: 'PAYMENT_RECEIVED_DURING_CANCELLATION',
    });
    return { latePaymentFulfilled: Boolean(confirmed) };
  }
  return { latePaymentFulfilled: false };
}

async function resolveEventMapCustomerCreationIssue(input: {
  contaId: string;
  orderId: string;
  externalReference: string;
}) {
  await prisma.financeReconciliationIssue.updateMany({
    where: {
      contaId: input.contaId,
      dedupeKey: `BILLING_OPERATION_UNCERTAIN:PAYMENT:${input.orderId}`,
      status: 'OPEN',
      AND: [
        { metadata: { path: ['operation'], equals: 'CUSTOMER_CREATION' } },
        { metadata: { path: ['customerCreationPostStarted'], equals: true } },
        { metadata: { path: ['externalReference'], equals: input.externalReference } },
      ],
    },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolution: 'Customer identity was persisted to the checkout order.',
    },
  });
}

async function resolveEventMapPaymentCreationIssue(input: {
  contaId: string;
  orderId: string;
  externalReference: string;
  apiKey: string;
  paymentId: string;
  customerId: string | null;
  paymentMethod: string | null;
  totalAmount: number | Prisma.Decimal;
}) {
  const issue = await prisma.financeReconciliationIssue.findFirst({
    where: {
      contaId: input.contaId,
      entityType: 'PAYMENT',
      entityId: input.orderId,
      issueType: 'BILLING_OPERATION_UNCERTAIN',
      dedupeKey: `BILLING_OPERATION_UNCERTAIN:PAYMENT:${input.orderId}`,
      status: 'OPEN',
      metadata: { path: ['externalReference'], equals: input.externalReference },
    },
    select: { id: true, remoteStatus: true },
  });
  // Resolve only the legacy preflight issue that explicitly recorded no
  // remote match. Conflicts, multiple candidates and ambiguous POST outcomes
  // require their own reconciliation path even if the order has a payment ID.
  if (!issue || issue.remoteStatus !== 'NOT_FOUND' || !input.customerId || !input.paymentMethod) return;

  let remotePayment: EventAsaasPayment;
  try {
    remotePayment = await getEventAsaasPaymentProvider().getPayment({
      apiKey: input.apiKey,
      paymentId: input.paymentId,
    });
  } catch (error) {
    logEventsFinance('finance.events.public_event_map.checkout.payment_reconciliation.failed', { error }, 'warn');
    return;
  }
  if (
    remotePayment.id !== input.paymentId ||
    remotePayment.externalReference !== input.externalReference ||
    remotePayment.customer !== input.customerId ||
    remotePayment.billingType !== input.paymentMethod ||
    typeof remotePayment.value !== 'number' ||
    toMoney(remotePayment.value) !== toMoney(input.totalAmount) ||
    remotePayment.deleted === true ||
    !remotePayment.status
  ) return;

  await prisma.financeReconciliationIssue.updateMany({
    where: {
      id: issue.id,
      contaId: input.contaId,
      entityType: 'PAYMENT',
      entityId: input.orderId,
      issueType: 'BILLING_OPERATION_UNCERTAIN',
      dedupeKey: `BILLING_OPERATION_UNCERTAIN:PAYMENT:${input.orderId}`,
      status: 'OPEN',
      remoteStatus: 'NOT_FOUND',
      metadata: { path: ['externalReference'], equals: input.externalReference },
    },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolution: 'The persisted Asaas payment was verified against the checkout order.',
    },
  });
}

async function hasCustomerCreationPostMarker(input: {
  contaId: string;
  orderId: string;
  externalReference: string;
}) {
  const issue = await prisma.financeReconciliationIssue.findFirst({
    where: {
      contaId: input.contaId,
      entityType: 'PAYMENT',
      entityId: input.orderId,
      issueType: 'BILLING_OPERATION_UNCERTAIN',
    },
    select: { metadata: true },
  });
  const metadata = issue?.metadata;
  if (!issue || !(metadata !== null &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    metadata.operation === 'CUSTOMER_CREATION' &&
    metadata.customerCreationPostStarted === true &&
    metadata.externalReference === input.externalReference)) return null;
  if (typeof metadata.customerCreationPostStartedAt !== 'string') {
    return { exists: true, startedAt: null };
  }
  const attemptStartedAt = new Date(metadata.customerCreationPostStartedAt);
  return {
    exists: true,
    startedAt: Number.isFinite(attemptStartedAt.getTime()) ? attemptStartedAt : null,
  };
}

async function fenceCustomerCreationAttempt(input: {
  apiKey: string;
  contaId: string;
  orderId: string;
  expectedPaymentStatus: string;
  externalReference: string;
  buyerDocument: string;
}) {
  let candidates: EventAsaasCustomer[] = [];
  let lookupReason = 'CUSTOMER_CREATION_UNKNOWN_NO_MATCH';
  try {
    const matches = await listCompleteEventCustomersByReference({
      apiKey: input.apiKey,
      externalReference: input.externalReference,
    });
    const active = matches.filter((customer) => !customer.deleted);
    const compatible = active.filter((customer) => customer.cpfCnpj?.replace(/\D/g, '') === input.buyerDocument);
    if (active.length === 1 && compatible.length === 1) candidates = compatible;
    else lookupReason = active.length > 1
      ? 'MULTIPLE_REMOTE_CUSTOMERS'
      : active.length === 0
        ? 'CUSTOMER_CREATION_UNKNOWN_NO_MATCH'
        : 'CUSTOMER_CREATION_CUSTOMER_MISMATCH';
  } catch {
    lookupReason = 'CUSTOMER_REFERENCE_LOOKUP_INCOMPLETE';
  }

  const customer = candidates[0];
  const fenced = await prisma.eventMapOrder.updateMany({
    where: {
      id: input.orderId,
      contaId: input.contaId,
      status: 'PAYMENT_PENDING',
      asaasPaymentId: null,
      asaasCustomerId: null,
      paymentStatus: input.expectedPaymentStatus,
    },
    data: customer
      ? { paymentStatus: null, asaasCustomerId: customer.id }
      : { paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
  });
  if (fenced.count === 1 && customer) {
    await resolveEventMapCustomerCreationIssue({
      contaId: input.contaId,
      orderId: input.orderId,
      externalReference: input.externalReference,
    });
  } else if (fenced.count === 1) {
    await upsertFinanceReconciliationIssue({
      contaId: input.contaId,
      entityType: 'PAYMENT',
      entityId: input.orderId,
      issueType: 'BILLING_OPERATION_UNCERTAIN',
      severity: 'CRITICAL',
      localStatus: 'PAYMENT_CREATION_UNKNOWN',
      remoteStatus: lookupReason,
      metadata: {
        orderId: input.orderId,
        externalReference: input.externalReference,
        operation: 'CUSTOMER_CREATION',
        customerCreationPostStarted: true,
      },
    });
  }

  throw new EventsError(
    'PAGAMENTO_EM_VERIFICACAO',
    customer && fenced.count === 1
      ? 'O cadastro do comprador foi recuperado. Consulte novamente para continuar com o pagamento.'
      : 'O cadastro do comprador ainda está sendo verificado com o provedor. A instituição precisa confirmar o resultado antes de continuar.',
    409,
  );
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
  const enqueueCreatedEmail = async (order: typeof pending.order) => {
    const paymentStatus = order.paymentStatus?.trim().toUpperCase();
    if (order.status !== 'PAYMENT_PENDING' || PAID_ASAAS_PAYMENT_STATUSES.has(paymentStatus ?? '')) return;
    await prisma.$transaction(async (tx) => {
      await enqueuePublicOrderCreatedEmail(tx, {
        contaId: pending.map.contaId,
        orderId: order.id,
        buyerEmail: order.buyerEmail,
        buyerName: order.buyerName,
        eventName: `${pending.map.event.name} · ${pending.map.name}`,
        eventStartsAt: pending.publishedMapSchedule.startsAt
          ? new Date(pending.publishedMapSchedule.startsAt)
          : pending.map.startsAt ?? pending.map.event.startsAt,
        eventStartsAtLocal: pending.publishedMapSchedule.startsAtLocal,
        statusPath: publicOrderStatusPath(pending.map.publicSlug, order.id, order.accessToken),
        invoiceUrl: order.invoiceUrl,
        paymentMethod: order.paymentMethod,
        expiresAt: order.expiresAt ?? pending.expiresAt,
      });
    });
  };
  let paymentCreationClaimed = false;
  let paymentCreationStarted = false;
  let customerCreationStarted = false;
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
      if (pending.order.paymentStatus !== 'PAYMENT_CREATION_UNKNOWN') {
        await resolveEventMapPaymentCreationIssue({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          externalReference: `event-map-order:${pending.order.id}`,
          apiKey: credentials.apiKey,
          paymentId: pending.order.asaasPaymentId,
          customerId: pending.order.asaasCustomerId,
          paymentMethod: pending.order.paymentMethod,
          totalAmount: pending.totalAmount,
        });
      }
      // The payment may have been attached before the process failed to enqueue
      // the buyer notification. The outbox key is stable per tenant and order,
      // so recreating it here is safe for retries and already delivered mail.
      await enqueueCreatedEmail(pending.order);
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
        const resolvedBuyerCustomerId = await requireBuyerAsaasCustomerId({
          apiKey: credentials.apiKey,
          contaId: pending.map.contaId,
          buyerDocument,
          localCustomerId: currentOrder?.asaasCustomerId,
        });
        if (!resolvedBuyerCustomerId) throw new Error('BUYER_ASAAS_CUSTOMER_NOT_UNIQUELY_CONFIRMED');
        buyerCustomerId = resolvedBuyerCustomerId;
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
      await enqueueCreatedEmail(reconciledOrder);
      return buildCheckoutResponse(reconciledOrder, {
        apiKey: credentials.apiKey,
        paymentMethod: input.paymentMethod,
        publicSlug: pending.map.publicSlug,
      });
    }

    if (pending.order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS') {
      paymentReferenceCandidateBlocked = true;
      const customerCreationDetectedAt = !pending.order.asaasCustomerId
        ? await hasCustomerCreationPostMarker({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          externalReference,
        })
        : null;
      const customerCreationIsStale = customerCreationDetectedAt?.startedAt !== null &&
        customerCreationDetectedAt?.startedAt !== undefined &&
        customerCreationDetectedAt.startedAt.getTime() <= Date.now() - CUSTOMER_CREATION_IN_PROGRESS_STALE_AFTER_MS;
      if (customerCreationIsStale) {
        await fenceCustomerCreationAttempt({
          apiKey: credentials.apiKey,
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
          externalReference,
          buyerDocument,
        });
      }
      throw new EventsError(
        'PAGAMENTO_EM_VERIFICACAO',
        'Estamos verificando a cobrança com o provedor. Aguarde um pouco e tente consultar o pedido novamente.',
        409,
      );
    }

    if (pending.order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN') {
      if (pending.order.asaasCustomerId) {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_UNKNOWN',
          externalReference,
          reason: 'PAYMENT_CREATION_UNKNOWN_NO_MATCH',
          metadata: { lookupStatus: 'COMPLETE_NO_MATCH', retryBlocked: true },
        });
        throw new EventsError(
          'PAGAMENTO_EM_VERIFICACAO',
          'A cobrança ainda está sendo verificada com o provedor. A equipe da instituição precisa confirmar o resultado antes de tentar novamente.',
          409,
        );
      }
      paymentReferenceCandidateBlocked = true;
      const customerCreationMarker = await hasCustomerCreationPostMarker({
        contaId: pending.map.contaId,
        orderId: pending.order.id,
        externalReference,
      });
      if (customerCreationMarker?.exists) {
        await fenceCustomerCreationAttempt({
          apiKey: credentials.apiKey,
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_UNKNOWN',
          externalReference,
          buyerDocument,
        });
      }
      paymentReferenceCandidateBlocked = false;
    }

    // In legacy rows, a null customer ID is durable evidence that the request
    // claim immediately preceding the payment POST never succeeded. Unknown
    // rows with a customer ID stay blocked because the POST may have started.
    if (
      pending.order.paymentStatus !== null &&
      pending.order.paymentStatus !== 'PAYMENT_CREATION_UNKNOWN'
    ) {
      paymentReferenceCandidateBlocked = true;
      await markEventMapPaymentReconciliationRequired({
        contaId: pending.map.contaId,
        orderId: pending.order.id,
        expectedPaymentStatus: pending.order.paymentStatus,
        externalReference,
        reason: 'UNRESOLVED_PAYMENT_STATUS_NO_MATCH',
        metadata: { lookupStatus: 'COMPLETE_NO_MATCH', retryBlocked: true },
      });
      throw new EventsError('PAGAMENTO_EM_VERIFICACAO', 'A cobrança precisa ser reconciliada antes de uma nova tentativa.', 409);
    }

    // A null status is the pre-POST state; claim it atomically before the first
    // remote payment request.
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

    let customerId: string | null = null;
    try {
      if (!customerId) customerId = await requireBuyerAsaasCustomerId({
          apiKey: credentials.apiKey,
          contaId: pending.map.contaId,
          buyerDocument,
          localCustomerId: pending.order.asaasCustomerId,
        });
    } catch (error) {
      if (error instanceof Error && error.message === 'BUYER_ASAAS_CUSTOMER_IDENTITY_CONFLICT') {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
          externalReference,
          reason: 'BUYER_CUSTOMER_IDENTITY_CONFLICT',
          metadata: { lookupStatus: 'LOCAL_IDENTITY_CONFLICT' },
        });
        throw new EventsError('COMPRADOR_EM_RECONCILIACAO', 'O vínculo do comprador precisa ser reconciliado antes de continuar.', 409);
      }
      const activeCustomers = (await listCompleteEventCustomersByDocument({ apiKey: credentials.apiKey, cpfCnpj: buyerDocument }))
        .filter((customer) => !customer.deleted);
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
        throw new EventsError('COMPRADOR_DUPLICADO_EM_RECONCILIACAO', 'Encontramos mais de um cadastro para o comprador. A equipe da instituição precisa verificar antes de continuar.', 409);
      }
      if (error instanceof Error && error.message === 'BUYER_ASAAS_CUSTOMER_LINK_NOT_FOUND') {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
          externalReference,
          reason: 'LINKED_BUYER_CUSTOMER_NOT_FOUND',
          metadata: { lookupStatus: 'COMPLETE_NO_ACTIVE_CUSTOMER' },
        });
        throw new EventsError('COMPRADOR_EM_RECONCILIACAO', 'O cadastro Asaas vinculado ao responsável não está disponível. A equipe da instituição precisa verificar antes de continuar.', 409);
      }
      throw error;
    }
    let resolvedCustomerId = customerId ?? '';
    if (!resolvedCustomerId) {
      const customerCreationPostStartedAt = new Date().toISOString();
      await upsertFinanceReconciliationIssue({
        contaId: pending.map.contaId,
        entityType: 'PAYMENT',
        entityId: pending.order.id,
        issueType: 'BILLING_OPERATION_UNCERTAIN',
        severity: 'HIGH',
        localStatus: 'PAYMENT_CREATION_IN_PROGRESS',
        remoteStatus: 'CUSTOMER_CREATION_POST_STARTED',
        metadata: {
          orderId: pending.order.id,
          externalReference,
          operation: 'CUSTOMER_CREATION',
          customerCreationPostStarted: true,
          customerCreationPostStartedAt,
        },
      });
      customerCreationStarted = true;
      let customer: EventAsaasCustomer;
      try {
        customer = await getEventAsaasPaymentProvider().createCustomer({
          apiKey: credentials.apiKey,
          idempotencyKey: buildEventMapAsaasIdempotencyKey('customer', pending.order.id),
          data: {
            name: input.buyerName,
            email: input.buyerEmail,
            cpfCnpj: buyerDocument,
            mobilePhone: input.buyerPhone,
            externalReference,
            notificationDisabled: false,
          },
        });
      } catch (error) {
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
          externalReference,
          reason: 'CUSTOMER_CREATION_RESPONSE_UNKNOWN',
          operation: 'CUSTOMER_CREATION',
          metadata: {
            operation: 'CUSTOMER_CREATION',
            customerCreationPostStarted: true,
            customerCreationPostStartedAt,
          },
        });
        paymentReferenceCandidateBlocked = true;
        throw new EventsError('COMPRADOR_EM_RECONCILIACAO', 'O cadastro do comprador está sendo verificado com o provedor.', 409);
      }
      const persistedCustomer = await prisma.eventMapOrder.updateMany({
        where: {
          id: pending.order.id,
          contaId: pending.map.contaId,
          status: 'PAYMENT_PENDING',
          asaasPaymentId: null,
          paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
        },
        data: { asaasCustomerId: customer.id },
      });
      if (persistedCustomer.count !== 1) {
        paymentReferenceCandidateBlocked = true;
        throw new EventsError('COMPRADOR_EM_RECONCILIACAO', 'O cadastro foi criado, mas o pedido precisa ser reconciliado.', 409);
      }
      customerCreationStarted = false;
      resolvedCustomerId = customer.id;
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
          // Keep the database claim exclusive while the provider request is in flight.
          // UNKNOWN is reserved for a response that is actually ambiguous.
          paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
          asaasCustomerId: resolvedCustomerId,
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
      await resolveEventMapCustomerCreationIssue({
        contaId: pending.map.contaId,
        orderId: pending.order.id,
        externalReference,
      });
      paymentCreationStarted = true;
      payment = await getEventAsaasPaymentProvider().createPayment({
        apiKey: credentials.apiKey,
        idempotencyKey: buildEventMapAsaasIdempotencyKey('payment', pending.order.id),
        data: {
          customer: resolvedCustomerId,
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
        payment.customer !== resolvedCustomerId
      ) {
        paymentReferenceCandidateBlocked = true;
        await markEventMapPaymentReconciliationRequired({
          contaId: pending.map.contaId,
          orderId: pending.order.id,
          expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
          externalReference,
          reason: 'POST_RESPONSE_MISMATCH',
          metadata: {
            paymentId: payment?.id ?? null,
            referenceMatched: payment?.externalReference === externalReference,
            valueMatched: typeof payment?.value === 'number' && toMoney(payment.value) === toMoney(pending.totalAmount),
            billingTypeMatched: payment?.billingType === input.paymentMethod,
            customerMatched: payment?.customer === resolvedCustomerId,
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
          expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
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
          recovered.customer !== resolvedCustomerId
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
          expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
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
        paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
      },
      data: {
        asaasCustomerId: resolvedCustomerId,
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
        expectedPaymentStatus: 'PAYMENT_CREATION_IN_PROGRESS',
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

    if (updated.status === 'CANCELLED') {
      // CANCELLED is terminal even when the provider accepts the payment POST
      // concurrently. Preserve the remote payment identity, but never reclaim
      // seats or fulfill tickets from this checkout response.
      const cancelledPaymentStatus = await withSessionAdvisoryLock({
        contaId: pending.map.contaId,
        scope: 'webhook-process',
        key: `payment:${payment.id}`,
        fn: async () => {
          const current = await prisma.eventMapOrder.findFirst({
            where: {
              id: updated.id,
              contaId: pending.map.contaId,
              status: 'CANCELLED',
              OR: [{ asaasPaymentId: null }, { asaasPaymentId: payment.id }],
            },
            select: { id: true, paymentStatus: true, asaasPaymentId: true },
          });
          if (!current) return (payment.status ?? 'PENDING').trim().toUpperCase();

          const currentStatus = current.paymentStatus?.trim().toUpperCase() ?? null;
          const incomingStatus = (payment.status ?? 'PENDING').trim().toUpperCase();
          const currentIsPaid = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'].includes(currentStatus ?? '');
          const incomingIsOpen = ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'].includes(incomingStatus);
          const resolvedStatus = currentIsPaid && incomingIsOpen
            ? currentStatus!
            : resolveMonotonicAsaasPaymentStatus({
                currentAsaasStatus: current.paymentStatus,
                incoming: incomingStatus,
              }) ?? incomingStatus;
          await prisma.eventMapOrder.updateMany({
            where: {
              id: current.id,
              contaId: pending.map.contaId,
              status: 'CANCELLED',
              paymentStatus: current.paymentStatus,
              OR: [{ asaasPaymentId: null }, { asaasPaymentId: payment.id }],
            },
            data: {
              asaasPaymentId: payment.id,
              asaasCustomerId: resolvedCustomerId,
              paymentMethod: input.paymentMethod,
              paymentStatus: resolvedStatus,
              paymentProvider: 'ASAAS',
              invoiceUrl: payment.invoiceUrl ?? null,
            },
          });
          const persisted = await prisma.eventMapOrder.findFirst({
            where: { id: current.id, contaId: pending.map.contaId, status: 'CANCELLED' },
            select: { paymentStatus: true, asaasPaymentId: true },
          });
          return persisted?.asaasPaymentId === payment.id
            ? (persisted.paymentStatus ?? resolvedStatus).trim().toUpperCase()
            : resolvedStatus;
        },
      });
      if (PAID_ASAAS_PAYMENT_STATUSES.has(cancelledPaymentStatus)) {
        await upsertFinanceReconciliationIssue({
          contaId: pending.map.contaId,
          entityType: 'PAYMENT',
          entityId: updated.id,
          asaasId: payment.id,
          issueType: 'PAYMENT_NEEDS_REVIEW',
          severity: 'HIGH',
          localStatus: 'CANCELLED',
          remoteStatus: cancelledPaymentStatus,
          causeId: `payment-post:${payment.id}`,
          metadata: {
            source: 'public-event-map-checkout',
            reason: 'cancelled_order_payment_created_paid',
            eventMapOrderId: updated.id,
            seatsMustNotBeReopenedAutomatically: true,
          },
        });
      } else if (!payment.deleted && CANCELLABLE_ASAAS_PAYMENT_STATUSES.has(cancelledPaymentStatus)) {
        const cancellationStarted = await beginEventMapPaymentCancellation({
          contaId: pending.map.contaId,
          orderId: updated.id,
          paymentId: payment.id,
          orderStatus: 'CANCELLED',
        });
        if (cancellationStarted) await getEventAsaasPaymentProvider()
          .deletePayment({ apiKey: credentials.apiKey, paymentId: payment.id })
          .then((deletedPayment) => recordSuccessfulEventMapPaymentCancellation({
            contaId: pending.map.contaId,
            orderId: updated.id,
            paymentId: payment.id,
            orderStatus: 'CANCELLED',
            apiKey: credentials.apiKey,
            remoteStatus: deletedPayment.deleted ? 'DELETED' : deletedPayment.status ?? null,
          }))
          .catch((deleteError) => {
            logEventsFinance(
              'finance.events.public_event_map.checkout.late_payment_cancel.failed',
              { error: deleteError },
              'error',
            );
            return recordFailedEventMapPaymentCancellation({
              contaId: pending.map.contaId,
              orderId: updated.id,
              paymentId: payment.id,
              orderStatus: 'CANCELLED',
              apiKey: credentials.apiKey,
              paymentStatus: cancelledPaymentStatus,
              error: deleteError,
            });
          });
      }
      throw new EventsError(
        'PEDIDO_CANCELADO',
        'O pedido foi cancelado enquanto a cobrança era criada. Consulte a instituição para reconciliar o pagamento.',
        409,
      );
    }

    if (updated.status === 'EXPIRED') {
      // The hold expired while the provider request was in flight. Persist the
      // provider identity for reconciliation, cancel a still-payable charge,
      // and never return a live checkout URL for an order whose seats were
      // released to another buyer.
      const paymentStatus = await withSessionAdvisoryLock({
        contaId: pending.map.contaId,
        scope: 'webhook-process',
        key: `payment:${payment.id}`,
        fn: async () => {
          const current = await prisma.eventMapOrder.findFirst({
            where: {
              id: updated.id,
              contaId: pending.map.contaId,
              status: 'EXPIRED',
              OR: [{ asaasPaymentId: null }, { asaasPaymentId: payment.id }],
            },
            select: { id: true, paymentStatus: true, asaasPaymentId: true },
          });
          if (!current) return (payment.status ?? '').trim().toUpperCase();
          const currentStatus = current.paymentStatus?.trim().toUpperCase() ?? null;
          const incomingStatus = (payment.status ?? '').trim().toUpperCase();
          const currentIsPaid = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'].includes(currentStatus ?? '');
          const incomingIsOpen = ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'].includes(incomingStatus);
          const resolvedStatus = currentIsPaid && incomingIsOpen
            ? currentStatus!
            : resolveMonotonicAsaasPaymentStatus({ currentAsaasStatus: current.paymentStatus, incoming: incomingStatus }) ?? incomingStatus;
          await prisma.eventMapOrder.updateMany({
            where: {
              id: current.id,
              contaId: pending.map.contaId,
              status: 'EXPIRED',
              paymentStatus: current.paymentStatus,
              OR: [{ asaasPaymentId: null }, { asaasPaymentId: payment.id }],
            },
            data: {
              asaasPaymentId: payment.id,
              asaasCustomerId: resolvedCustomerId,
              paymentMethod: input.paymentMethod,
              paymentStatus: resolvedStatus,
              paymentProvider: 'ASAAS',
              invoiceUrl: payment.invoiceUrl ?? null,
            },
          });
          const persisted = await prisma.eventMapOrder.findFirst({
            where: { id: current.id, contaId: pending.map.contaId, status: 'EXPIRED' },
            select: { paymentStatus: true, asaasPaymentId: true },
          });
          return persisted?.asaasPaymentId === payment.id
            ? (persisted.paymentStatus ?? resolvedStatus).trim().toUpperCase()
            : resolvedStatus;
        },
      });
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
        let fulfilledOrder: typeof updated | null = null;
        if (confirmed) {
          fulfilledOrder = await prisma.eventMapOrder.findFirst({
            where: {
              id: updated.id,
              contaId: pending.map.contaId,
              status: 'CONFIRMED',
              asaasPaymentId: payment.id,
            },
            include: { items: { include: { ticket: true } } },
          });
          if (fulfilledOrder) {
            return buildCheckoutResponse(fulfilledOrder, {
              apiKey: credentials.apiKey,
              paymentMethod: input.paymentMethod,
              publicSlug: pending.map.publicSlug,
            });
          }
        }
        if (!confirmed || !fulfilledOrder) {
          await reconcileEventMapOrderFinancialStateFromAsaas({
            ...latePaymentParams,
            ticketFulfillmentError: 'PAYMENT_CREATED_AFTER_RESERVATION_EXPIRED',
          });
        }
      } else if (!payment.deleted && CANCELLABLE_ASAAS_PAYMENT_STATUSES.has(paymentStatus)) {
        const cancellationStarted = await beginEventMapPaymentCancellation({
          contaId: pending.map.contaId,
          orderId: updated.id,
          paymentId: payment.id,
          orderStatus: 'EXPIRED',
        });
        const cancellationOutcome = cancellationStarted ? await getEventAsaasPaymentProvider()
          .deletePayment({ apiKey: credentials.apiKey, paymentId: payment.id })
          .then((deletedPayment) => recordSuccessfulEventMapPaymentCancellation({
              contaId: pending.map.contaId,
              orderId: updated.id,
              paymentId: payment.id,
              orderStatus: 'EXPIRED',
              apiKey: credentials.apiKey,
              remoteStatus: deletedPayment.deleted ? 'DELETED' : deletedPayment.status ?? null,
            }))
          .catch((deleteError) => {
            logEventsFinance(
              'finance.events.public_event_map.checkout.late_payment_cancel.failed',
              { error: deleteError },
              'error',
            );
            return recordFailedEventMapPaymentCancellation({
              contaId: pending.map.contaId,
              orderId: updated.id,
              paymentId: payment.id,
              orderStatus: 'EXPIRED',
              apiKey: credentials.apiKey,
              paymentStatus,
              error: deleteError,
            });
          }) : null;
        if (cancellationOutcome?.latePaymentFulfilled) {
          const fulfilledOrder = await prisma.eventMapOrder.findFirst({
            where: { id: updated.id, contaId: pending.map.contaId, status: 'CONFIRMED', asaasPaymentId: payment.id },
            include: { items: { include: { ticket: true } } },
          });
          if (fulfilledOrder) return buildCheckoutResponse(fulfilledOrder, {
            apiKey: credentials.apiKey,
            paymentMethod: input.paymentMethod,
            publicSlug: pending.map.publicSlug,
          });
        }
      }
      throw new EventsError(
        'RESERVA_EXPIRADA',
        'O prazo da reserva terminou enquanto a cobrança era criada. Consulte o pedido ou fale com a instituição.',
        409,
      );
    }

    await enqueueCreatedEmail(updated);

    return buildCheckoutResponse(updated, {
      apiKey: credentials.apiKey,
      paymentMethod: input.paymentMethod,
      publicSlug: pending.map.publicSlug,
    });
  } catch (error) {
    if (paymentCreationClaimed && !paymentCreationStarted && !customerCreationStarted) {
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
