import { prisma } from '@alusa/database';
import { Prisma } from '@prisma/client';
import { loadDecryptedAsaasCredentials } from '@alusa/lib/services/integracoes/asaas-credentials-service';
import { getEventAsaasPaymentProvider } from '@alusa/lib/events/event-asaas-payment-provider';
import type { EventAsaasPayment } from '@alusa/lib/events/event-asaas-payment-provider';
import {
  confirmPublicEventMapOrderPayment,
  reconcileEventMapOrderFinancialStateFromAsaas,
  recordPublicOrderTicketFulfillmentFailure,
} from '@alusa/lib/events/map/event-map.service';

import { withWebhookJobLock } from '../foundation/webhook-job-lock.service';
import {
  resolveFinanceReconciliationIssueByDedupe,
  upsertFinanceReconciliationIssue,
} from '../reconciliation/finance-reconciliation-issue.service';
import { logEventsFinance } from './events-finance-observability';
import {
  reconcileEventMapOrderPayment,
  type ReconcileEventMapOrderPaymentInput,
  type ReconcileEventMapOrderPaymentResult,
} from './reconcile-event-map-order-payment';

type EventMapPublicSeatStatusValue = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'UNAVAILABLE';
type EventMapReservationStatusValue = 'HELD' | 'EXPIRED' | 'CONSUMED' | 'CANCELLED';
type EventMapOrderStatusValue = 'PAYMENT_PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
type EventMapTicketFulfillmentStatusValue = 'PENDING' | 'ISSUED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
type ExternalPaymentResolution = {
  decision: 'PAID' | 'DELETED' | 'NO_PAYMENT' | 'NOT_CANCELLABLE';
  paymentId?: string;
};

export type ExpirableEventMapReservationRecord = {
  id: string;
  contaId: string;
  eventId: string;
  eventMapId: string;
  status: EventMapReservationStatusValue;
  expiresAt: Date;
  seats: Array<{
    publicSeatId: string;
    publicSeat: {
      status: EventMapPublicSeatStatusValue;
    };
  }>;
  order: {
    id: string;
    status: EventMapOrderStatusValue;
    asaasPaymentId: string | null;
    paymentStatus: string | null;
    updatedAt: Date;
    ticketCount: number;
  } | null;
};

type RawExpirableEventMapReservationRecord = {
  id: string;
  contaId: string;
  eventId: string;
  eventMapId: string;
  status: EventMapReservationStatusValue;
  expiresAt: Date;
  seats: Array<{
    publicSeatId: string;
    publicSeat: {
      status: EventMapPublicSeatStatusValue;
    };
  }>;
  order: {
    id: string;
    status: EventMapOrderStatusValue;
    asaasPaymentId: string | null;
    paymentStatus: string | null;
    updatedAt: Date;
    _count: {
      tickets: number;
    };
  } | null;
};

export type ExpiredReservationDecision =
  | { expire: true }
  | { expire: false; reason: string };

class ReservationExpirationConflict extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ReservationExpirationConflict';
  }
}

const PAID_ASAAS_PAYMENT_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

const CANCELLABLE_ASAAS_PAYMENT_STATUSES = new Set([
  'PENDING',
  'OVERDUE',
  'AWAITING_RISK_ANALYSIS',
]);

export function getExpiredReservationDecision(
  reservation: ExpirableEventMapReservationRecord,
  now = new Date(),
  options: { deletedAsaasPaymentId?: string | null; noRemotePaymentConfirmed?: boolean } = {},
): ExpiredReservationDecision {
  if (reservation.status !== 'HELD') {
    return { expire: false, reason: 'reservation_not_held' };
  }

  if (reservation.expiresAt >= now) {
    return { expire: false, reason: 'reservation_not_expired' };
  }

  if (reservation.seats.some((seat) => seat.publicSeat.status !== 'HELD')) {
    return { expire: false, reason: 'seat_not_held' };
  }

  if (!reservation.order) {
    return { expire: true };
  }

  if (reservation.order.status !== 'PAYMENT_PENDING') {
    return { expire: false, reason: 'order_not_pending' };
  }

  const paymentCreationUnresolved = reservation.order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS'
    || reservation.order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN';
  if (
    paymentCreationUnresolved &&
    !options.deletedAsaasPaymentId &&
    !options.noRemotePaymentConfirmed
  ) {
    return { expire: false, reason: 'external_payment_requires_reconciliation' };
  }

  if (reservation.order.ticketCount > 0) {
    return { expire: false, reason: 'ticket_already_issued' };
  }

  if (
    reservation.order.asaasPaymentId &&
    options.deletedAsaasPaymentId !== reservation.order.asaasPaymentId
  ) {
    return { expire: false, reason: 'external_payment_requires_reconciliation' };
  }

  return { expire: true };
}

export type ExpireEventMapReservationsInput = {
  contaId?: string;
  now?: Date;
  limit?: number;
  maxAccounts?: number;
  /** Maximum number of expired payments to reconcile against Asaas in one run. */
  maxExternalPaymentChecks?: number;
  useLock?: boolean;
};

export type ExpireEventMapReservationsResult = {
  processed: number;
  expired: number;
  skipped: number;
  errors: Array<{ reservationId: string; contaId: string; reason: string }>;
  generatedAt: Date;
  skippedDueToLock?: boolean;
};

type ExpireEventMapReservationsDependencies = {
  resolveTargetContaIds: (input: { contaId?: string; maxAccounts: number }) => Promise<string[]>;
  findExpiredReservations: (input: {
    contaId: string;
    now: Date;
    limit: number;
  }) => Promise<ExpirableEventMapReservationRecord[]>;
  expireReservation: (input: {
    contaId: string;
    reservationId: string;
    now: Date;
    deletedAsaasPaymentId?: string | null;
    noRemotePaymentConfirmed?: boolean;
  }) => Promise<{ expired: boolean; reason?: string }>;
  resolveExternalPaymentAtExpiry?: (input: {
    contaId: string;
    eventId: string;
    orderId: string;
    now: Date;
    paymentId?: string | null;
    paymentCreationUnresolved?: boolean;
    paymentCreationUpdatedAt: Date;
    reservationId: string;
  }) => Promise<ExternalPaymentResolution>;
};

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function confirmExpiredOrderPayment(params: {
  contaId: string;
  orderId: string;
  paymentId: string;
  payment: EventAsaasPayment;
  status: string;
}) {
  const paymentParams = {
    contaId: params.contaId,
    asaasPaymentId: params.paymentId,
    externalReference: `event-map-order:${params.orderId}`,
    paymentStatus: params.status,
    invoiceUrl: params.payment.invoiceUrl ?? null,
    paidAt: params.payment.paymentDate ?? params.payment.clientPaymentDate ?? new Date(),
    paidAmount: params.payment.value ?? null,
    allowReleasedReservation: true,
  };
  let confirmation: Awaited<ReturnType<typeof confirmPublicEventMapOrderPayment>>;
  let confirmationError: unknown;
  try {
    confirmation = await confirmPublicEventMapOrderPayment(paymentParams);
  } catch (error) {
    confirmation = null;
    confirmationError = error;
  }
  if (confirmation) return;

  const reconciliation = await reconcileEventMapOrderFinancialStateFromAsaas({
    ...paymentParams,
    ticketFulfillmentError: confirmationError
      ? typeof (confirmationError as { code?: unknown })?.code === 'string'
        ? (confirmationError as { code: string }).code
        : confirmationError instanceof Error
          ? confirmationError.message
          : String(confirmationError)
      : 'PEDIDO_NAO_ENCONTRADO',
  });
  if (!reconciliation) {
    throw confirmationError ?? new Error('EVENT_MAP_ORDER_NOT_FOUND_FOR_PAID_PAYMENT');
  }
}

async function resolveEventMapContaIds(input: { contaId?: string; maxAccounts: number }): Promise<string[]> {
  if (input.contaId) return [input.contaId];

  const [reservations, orders] = await Promise.all([
    prisma.eventMapReservation.findMany({
      where: { status: 'HELD' },
      select: { contaId: true },
      distinct: ['contaId'],
      orderBy: { updatedAt: 'asc' },
      take: input.maxAccounts,
    }),
    prisma.eventMapOrder.findMany({
      where: { status: 'PAYMENT_PENDING' },
      select: { contaId: true },
      distinct: ['contaId'],
      orderBy: { updatedAt: 'asc' },
      take: input.maxAccounts,
    }),
  ]);

  return [...new Set([...reservations, ...orders].map((entry) => entry.contaId))].slice(0, input.maxAccounts);
}

function mapReservationRecord(reservation: RawExpirableEventMapReservationRecord): ExpirableEventMapReservationRecord {
  return {
    id: reservation.id,
    contaId: reservation.contaId,
    eventId: reservation.eventId,
    eventMapId: reservation.eventMapId,
    status: reservation.status,
    expiresAt: reservation.expiresAt,
    seats: reservation.seats.map((seat) => ({
      publicSeatId: seat.publicSeatId,
      publicSeat: { status: seat.publicSeat.status },
    })),
    order: reservation.order
      ? {
          id: reservation.order.id,
          status: reservation.order.status,
          asaasPaymentId: reservation.order.asaasPaymentId,
          paymentStatus: reservation.order.paymentStatus,
          updatedAt: reservation.order.updatedAt,
          ticketCount: reservation.order._count.tickets,
        }
      : null,
  };
}

const defaultExpireEventMapReservationsDependencies = {
  resolveTargetContaIds: resolveEventMapContaIds,
  findExpiredReservations: async (input: {
    contaId: string;
    now: Date;
    limit: number;
  }) => {
    const reservations = await prisma.eventMapReservation.findMany({
      where: {
        contaId: input.contaId,
        status: 'HELD',
        expiresAt: { lt: input.now },
      },
      include: {
        seats: {
          select: {
            publicSeatId: true,
            publicSeat: { select: { status: true } },
          },
        },
        order: {
          select: {
            id: true,
            status: true,
            asaasPaymentId: true,
            paymentStatus: true,
            updatedAt: true,
            _count: { select: { tickets: true } },
          },
        },
      },
      orderBy: { expiresAt: 'asc' },
      take: input.limit,
    });

    return reservations.map(mapReservationRecord);
  },
  resolveExternalPaymentAtExpiry: async (input) => {
    // A concurrent checkout may still be waiting for the Asaas POST response.
    // Don't query a fresh claim and never interpret an empty lookup as proof
    // that no payment exists. Unknown outcomes stay held and surface as an
    // operational reconciliation issue.
    const staleCreationMs = 10 * 60_000;
    if (
      input.paymentCreationUnresolved &&
      input.now.getTime() - input.paymentCreationUpdatedAt.getTime() < staleCreationMs
    ) return { decision: 'NOT_CANCELLABLE' };
    const issueDedupeKey = `BILLING_OPERATION_UNCERTAIN:PAYMENT:${input.orderId}`;
    if (input.paymentCreationUnresolved) {
      const existingIssue = await prisma.financeReconciliationIssue.findFirst({
        where: { contaId: input.contaId, dedupeKey: issueDedupeKey, status: 'OPEN' },
        select: { lastSeenAt: true },
      });
      // A targeted Asaas reconciliation is capped to once per hour per
      // unresolved order. Webhooks remain the immediate state-change source.
      if (existingIssue && input.now.getTime() - existingIssue.lastSeenAt.getTime() < 60 * 60_000) {
        return { decision: 'NOT_CANCELLABLE' };
      }
    }
    const credentials = await loadDecryptedAsaasCredentials(input.contaId);
    if (!credentials?.apiKey) {
      throw new Error('ASAAS_CREDENTIALS_UNAVAILABLE');
    }

    let paymentId = input.paymentId;
    if (!paymentId) {
      const lookup = await getEventAsaasPaymentProvider().listPayments({
        apiKey: credentials.apiKey,
        externalReference: `event-map-order:${input.orderId}`,
        limit: 10,
      });
      const activePayments = lookup.data.filter((candidate) => !candidate.deleted);
      if (activePayments.length > 1) {
        await upsertFinanceReconciliationIssue({
          contaId: input.contaId,
          entityType: 'PAYMENT',
          entityId: input.orderId,
          issueType: 'BILLING_OPERATION_UNCERTAIN',
          severity: 'CRITICAL',
          localStatus: 'PAYMENT_CREATION_UNKNOWN',
          remoteStatus: 'MULTIPLE_PAYMENTS',
          metadata: { orderId: input.orderId, reservationId: input.reservationId },
        });
        return { decision: 'NOT_CANCELLABLE' };
      }
      const remotePayment = activePayments[0];
      if (!remotePayment) {
        if (input.paymentCreationUnresolved) {
          await upsertFinanceReconciliationIssue({
            contaId: input.contaId,
            entityType: 'PAYMENT',
            entityId: input.orderId,
            issueType: 'BILLING_OPERATION_UNCERTAIN',
            severity: 'HIGH',
            localStatus: 'PAYMENT_CREATION_UNKNOWN',
            remoteStatus: 'NOT_FOUND',
            metadata: {
              orderId: input.orderId,
              reservationId: input.reservationId,
              externalReference: `event-map-order:${input.orderId}`,
              policy: 'keep_seats_held_until_provider_outcome_is_known',
            },
          });
        }
        return { decision: 'NOT_CANCELLABLE' };
      }

      const localOrder = await prisma.eventMapOrder.findFirst({
        where: { id: input.orderId, contaId: input.contaId, status: 'PAYMENT_PENDING' },
        select: { totalAmount: true, paymentMethod: true, asaasCustomerId: true },
      });
      const paymentMatchesOrder = Boolean(
        localOrder &&
        remotePayment.externalReference === `event-map-order:${input.orderId}` &&
        Math.abs(Number(remotePayment.value) - Number(localOrder.totalAmount)) <= 0.01 &&
        (!localOrder.asaasCustomerId || remotePayment.customer === localOrder.asaasCustomerId) &&
        (!localOrder.paymentMethod || remotePayment.billingType === localOrder.paymentMethod),
      );
      if (!paymentMatchesOrder) {
        await upsertFinanceReconciliationIssue({
          contaId: input.contaId,
          entityType: 'PAYMENT',
          entityId: input.orderId,
          issueType: 'BILLING_OPERATION_UNCERTAIN',
          severity: 'CRITICAL',
          localStatus: 'PAYMENT_CREATION_UNKNOWN',
          remoteStatus: 'PAYMENT_MISMATCH',
          metadata: { orderId: input.orderId, reservationId: input.reservationId, paymentId: remotePayment.id },
        });
        return { decision: 'NOT_CANCELLABLE' };
      }

      paymentId = remotePayment.id;
      // Preserve the provider identity discovered by reconciliation before
      // deleting or applying its paid state, for audit and future webhooks.
      await prisma.eventMapOrder.updateMany({
        where: {
          id: input.orderId,
          contaId: input.contaId,
          status: 'PAYMENT_PENDING',
          asaasPaymentId: null,
        },
        data: {
          asaasPaymentId: remotePayment.id,
          paymentProvider: 'ASAAS',
          paymentStatus: remotePayment.status ?? 'PENDING',
          invoiceUrl: remotePayment.invoiceUrl ?? null,
          asaasCustomerId: remotePayment.customer ?? undefined,
        },
      });
      if (input.paymentCreationUnresolved) {
        await resolveFinanceReconciliationIssueByDedupe({
          contaId: input.contaId,
          dedupeKey: issueDedupeKey,
          resolution: 'Cobrança localizada no Asaas pela referência externa do pedido.',
        });
      }
    }

    let payment = await getEventAsaasPaymentProvider().getPayment({ apiKey: credentials.apiKey, paymentId });
    let status = (payment.status ?? '').trim().toUpperCase();

    if (PAID_ASAAS_PAYMENT_STATUSES.has(status)) {
      await confirmExpiredOrderPayment({
        contaId: input.contaId,
        orderId: input.orderId,
        paymentId,
        payment,
        status,
      });
      return { decision: 'PAID', paymentId };
    }

    if (payment.deleted || status === 'DELETED') return { decision: 'DELETED', paymentId };
    if (!CANCELLABLE_ASAAS_PAYMENT_STATUSES.has(status)) return { decision: 'NOT_CANCELLABLE', paymentId };

    const deletion = await getEventAsaasPaymentProvider().deletePayment({ apiKey: credentials.apiKey, paymentId });

    // DELETE already returns whether the payment was deleted. Avoid a second
    // provider read for the common successful path; only close the race when
    // the provider could not confirm deletion in its response.
    if (deletion.deleted) return { decision: 'DELETED', paymentId };

    // Read after delete to close the race with a payment being confirmed at expiry.
    payment = await getEventAsaasPaymentProvider().getPayment({ apiKey: credentials.apiKey, paymentId });
    status = (payment.status ?? '').trim().toUpperCase();
    if (PAID_ASAAS_PAYMENT_STATUSES.has(status)) {
      await confirmExpiredOrderPayment({
        contaId: input.contaId,
        orderId: input.orderId,
        paymentId,
        payment,
        status,
      });
      return { decision: 'PAID', paymentId };
    }

    return payment.deleted || status === 'DELETED'
      ? { decision: 'DELETED', paymentId }
      : { decision: 'NOT_CANCELLABLE', paymentId };
  },
  expireReservation: async (input: {
    contaId: string;
    reservationId: string;
    now: Date;
    deletedAsaasPaymentId?: string | null;
    noRemotePaymentConfirmed?: boolean;
  }) => {
    try {
      return await prisma.$transaction(async (tx) => {
        const reservation = await tx.eventMapReservation.findFirst({
          where: { id: input.reservationId, contaId: input.contaId, status: 'HELD' },
          include: {
            seats: {
              select: {
                publicSeatId: true,
                publicSeat: { select: { status: true } },
              },
            },
            order: {
              select: {
                id: true,
                status: true,
                asaasPaymentId: true,
                paymentStatus: true,
                updatedAt: true,
                _count: { select: { tickets: true } },
              },
            },
          },
        });

        if (!reservation) {
          return { expired: false, reason: 'reservation_not_found' };
        }

        const record = mapReservationRecord(reservation);
        const decision = getExpiredReservationDecision(record, input.now, {
          deletedAsaasPaymentId: input.deletedAsaasPaymentId,
          noRemotePaymentConfirmed: input.noRemotePaymentConfirmed,
        });
        if (!decision.expire) {
          return { expired: false, reason: decision.reason };
        }

        const seatIds = record.seats.map((seat) => seat.publicSeatId);
        if (seatIds.length > 0) {
          const seats = await tx.eventMapPublicSeat.updateMany({
            where: {
              contaId: input.contaId,
              id: { in: seatIds },
              status: 'HELD',
            },
            data: { status: 'AVAILABLE' },
          });

          if (seats.count !== seatIds.length) {
            throw new ReservationExpirationConflict('seat_not_held');
          }
        }

        const reservationUpdate = await tx.eventMapReservation.updateMany({
          where: { id: record.id, contaId: input.contaId, status: 'HELD' },
          data: { status: 'EXPIRED', checkoutKey: null, cancelledAt: input.now },
        });

        if (reservationUpdate.count === 0) {
          throw new ReservationExpirationConflict('reservation_not_held');
        }

        if (record.order) {
          const orderUpdate = await tx.eventMapOrder.updateMany({
            where: {
              id: record.order.id,
              contaId: input.contaId,
              status: 'PAYMENT_PENDING',
              ...(input.deletedAsaasPaymentId
                ? { asaasPaymentId: input.deletedAsaasPaymentId }
                : { asaasPaymentId: null }),
            },
            data: {
              status: 'EXPIRED',
              cancelledAt: input.now,
              paymentStatus: input.deletedAsaasPaymentId || input.noRemotePaymentConfirmed ? 'DELETED' : 'EXPIRED',
            },
          });
          if (orderUpdate.count !== 1) {
            throw new ReservationExpirationConflict('order_state_changed');
          }
        }

        await tx.eventAudit.create({
          data: {
            contaId: record.contaId,
            eventId: record.eventId,
            actorUserId: null,
            action: 'events.publicOrder.reservation.expire',
            entityType: 'EventMapReservation',
            entityId: record.id,
            before: toAuditJson({
              status: 'HELD',
              orderStatus: record.order?.status ?? null,
            }),
            after: toAuditJson({
              status: 'EXPIRED',
              orderStatus: record.order ? 'EXPIRED' : null,
            }),
            metadata: toAuditJson({
              eventMapId: record.eventMapId,
              orderId: record.order?.id ?? null,
              releasedSeats: seatIds.length,
              asaasPaymentDeleted: Boolean(input.deletedAsaasPaymentId),
            }),
          },
        });

        await tx.auditLog.create({
          data: {
            contaId: record.contaId,
            actorType: 'SYSTEM',
            actorId: null,
            action: 'events.publicOrder.reservation.expire',
            entityType: 'EventMapReservation',
            entityId: record.id,
            metadata: toAuditJson({
              eventId: record.eventId,
              eventMapId: record.eventMapId,
              orderId: record.order?.id ?? null,
              releasedSeats: seatIds.length,
              asaasPaymentDeleted: Boolean(input.deletedAsaasPaymentId),
            }),
          },
        });

        return { expired: true };
      });
    } catch (error) {
      if (error instanceof ReservationExpirationConflict) {
        return { expired: false, reason: error.reason };
      }
      throw error;
    }
  },
} satisfies ExpireEventMapReservationsDependencies;

export async function expireEventMapReservations(
  input: ExpireEventMapReservationsInput = {},
  dependencies: ExpireEventMapReservationsDependencies = defaultExpireEventMapReservationsDependencies,
): Promise<ExpireEventMapReservationsResult> {
  const run = () => expireEventMapReservationsUnlocked(input, dependencies);
  const useLock = input.useLock ?? dependencies === defaultExpireEventMapReservationsDependencies;
  if (!useLock) return run();

  const locked = await withWebhookJobLock(
    `events-expire-reservations:${input.contaId ?? 'global'}`,
    run,
    { ttlMs: 10 * 60_000 },
  );

  if (!locked.acquired) {
    return {
      processed: 0,
      expired: 0,
      skipped: 0,
      errors: [],
      generatedAt: new Date(),
      skippedDueToLock: true,
    };
  }

  return locked.result;
}

async function expireEventMapReservationsUnlocked(
  input: ExpireEventMapReservationsInput,
  dependencies: ExpireEventMapReservationsDependencies,
): Promise<ExpireEventMapReservationsResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const maxAccounts = Math.max(1, Math.min(50, input.maxAccounts ?? 20));
  let remainingExternalPaymentChecks = Math.max(0, Math.min(100, input.maxExternalPaymentChecks ?? 25));
  const result: ExpireEventMapReservationsResult = {
    processed: 0,
    expired: 0,
    skipped: 0,
    errors: [],
    generatedAt: now,
  };

  const contaIds = await dependencies.resolveTargetContaIds({ contaId: input.contaId, maxAccounts });
  for (const contaId of contaIds) {
    const reservations = await dependencies.findExpiredReservations({ contaId, now, limit });
    for (const reservation of reservations) {
      result.processed += 1;
      let deletedAsaasPaymentId: string | null = null;
      let noRemotePaymentConfirmed = false;
      const decision = getExpiredReservationDecision(reservation, now);
      if (
        !decision.expire &&
        decision.reason === 'external_payment_requires_reconciliation' &&
        reservation.order && (
          reservation.order.asaasPaymentId ||
          reservation.order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' ||
          reservation.order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN'
        ) &&
        remainingExternalPaymentChecks > 0 &&
        dependencies.resolveExternalPaymentAtExpiry
      ) {
        remainingExternalPaymentChecks -= 1;
        try {
          const paymentDecision = await dependencies.resolveExternalPaymentAtExpiry({
            contaId,
            eventId: reservation.eventId,
            orderId: reservation.order.id,
            now,
            reservationId: reservation.id,
            paymentId: reservation.order.asaasPaymentId,
            paymentCreationUnresolved:
              reservation.order.paymentStatus === 'PAYMENT_CREATION_IN_PROGRESS' ||
              reservation.order.paymentStatus === 'PAYMENT_CREATION_UNKNOWN',
            paymentCreationUpdatedAt: reservation.order.updatedAt,
          });

          if (paymentDecision.decision === 'PAID') {
            result.skipped += 1;
            logEventsFinance('eventMapReservation.expire.payment_confirmed', {
              contaId,
              eventId: reservation.eventId,
              reservationId: reservation.id,
              orderId: reservation.order.id,
              asaasPaymentId: reservation.order.asaasPaymentId,
            });
            continue;
          }

          if (paymentDecision.decision === 'NOT_CANCELLABLE') {
            result.skipped += 1;
            result.errors.push({ reservationId: reservation.id, contaId, reason: 'external_payment_not_cancellable' });
            continue;
          }

          if (paymentDecision.decision === 'NO_PAYMENT' || (paymentDecision.decision === 'DELETED' && !paymentDecision.paymentId && !reservation.order.asaasPaymentId)) {
            noRemotePaymentConfirmed = true;
          } else {
            deletedAsaasPaymentId = paymentDecision.paymentId ?? reservation.order.asaasPaymentId;
          }
        } catch (error) {
          result.skipped += 1;
          result.errors.push({
            reservationId: reservation.id,
            contaId,
            reason: error instanceof Error ? error.message : String(error),
          });
          logEventsFinance('eventMapReservation.expire.payment_cancel.error', {
            contaId,
            eventId: reservation.eventId,
            reservationId: reservation.id,
            orderId: reservation.order.id,
            asaasPaymentId: reservation.order.asaasPaymentId,
            message: error instanceof Error ? error.message : String(error),
          }, 'warn');
          continue;
        }
      } else if (!decision.expire) {
        result.skipped += 1;
        result.errors.push({ reservationId: reservation.id, contaId, reason: decision.reason });
        continue;
      }

      try {
        const expired = await dependencies.expireReservation({
          contaId,
          reservationId: reservation.id,
          now,
          deletedAsaasPaymentId,
          noRemotePaymentConfirmed,
        });
        if (expired.expired) {
          result.expired += 1;
          logEventsFinance('eventMapReservation.expire', {
            contaId,
            eventId: reservation.eventId,
            reservationId: reservation.id,
            orderId: reservation.order?.id ?? null,
          });
        } else {
          result.skipped += 1;
          result.errors.push({
            reservationId: reservation.id,
            contaId,
            reason: expired.reason ?? 'not_expired',
          });
        }
      } catch (error) {
        result.skipped += 1;
        result.errors.push({
          reservationId: reservation.id,
          contaId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logEventsFinance('eventMapReservation.expire.job', {
    processed: result.processed,
    skipped: result.skipped,
    errors: result.errors.length,
  });

  return result;
}

export type EventMapOrderReconciliationCandidate = {
  id: string;
  contaId: string;
  eventId: string;
  asaasPaymentId: string | null;
  paymentMethod: string | null;
};

export type ReconcilePendingEventMapOrdersInput = {
  contaId?: string;
  olderThanMinutes?: number;
  limit?: number;
  maxAccounts?: number;
  now?: Date;
  useLock?: boolean;
};

export type ReconcilePendingEventMapOrdersResult = {
  processed: number;
  updated: number;
  consistent: number;
  skipped: number;
  errors: Array<{ orderId: string; contaId: string; reason: string }>;
  generatedAt: Date;
  skippedDueToLock?: boolean;
};

type ReconcilePendingEventMapOrdersDependencies = {
  resolveTargetContaIds: (input: { contaId?: string; maxAccounts: number }) => Promise<string[]>;
  findOrders: (input: {
    contaId: string;
    createdBefore: Date;
    limit: number;
  }) => Promise<EventMapOrderReconciliationCandidate[]>;
  reconcileOrder: (input: ReconcileEventMapOrderPaymentInput) => Promise<ReconcileEventMapOrderPaymentResult>;
};

const defaultReconcilePendingEventMapOrdersDependencies = {
  resolveTargetContaIds: resolveEventMapContaIds,
  findOrders: async (input: { contaId: string; createdBefore: Date; limit: number }) => prisma.eventMapOrder.findMany({
    where: {
      contaId: input.contaId,
      status: 'PAYMENT_PENDING',
      asaasPaymentId: { not: null },
      paymentMethod: null,
      createdAt: { lt: input.createdBefore },
    },
    select: {
      id: true,
      contaId: true,
      eventId: true,
      asaasPaymentId: true,
      paymentMethod: true,
    },
    orderBy: { createdAt: 'asc' },
    take: input.limit,
  }),
  reconcileOrder: (input: ReconcileEventMapOrderPaymentInput) => reconcileEventMapOrderPayment(input),
} satisfies ReconcilePendingEventMapOrdersDependencies;

export async function reconcilePendingEventMapOrders(
  input: ReconcilePendingEventMapOrdersInput = {},
  dependencies: ReconcilePendingEventMapOrdersDependencies = defaultReconcilePendingEventMapOrdersDependencies,
): Promise<ReconcilePendingEventMapOrdersResult> {
  const run = () => reconcilePendingEventMapOrdersUnlocked(input, dependencies);
  const useLock = input.useLock ?? dependencies === defaultReconcilePendingEventMapOrdersDependencies;
  if (!useLock) return run();

  const locked = await withWebhookJobLock(
    `events-reconcile-orders:${input.contaId ?? 'global'}`,
    run,
    { ttlMs: 10 * 60_000 },
  );

  if (!locked.acquired) {
    return {
      processed: 0,
      updated: 0,
      consistent: 0,
      skipped: 0,
      errors: [],
      generatedAt: new Date(),
      skippedDueToLock: true,
    };
  }

  return locked.result;
}

async function reconcilePendingEventMapOrdersUnlocked(
  input: ReconcilePendingEventMapOrdersInput,
  dependencies: ReconcilePendingEventMapOrdersDependencies,
): Promise<ReconcilePendingEventMapOrdersResult> {
  const now = input.now ?? new Date();
  const olderThanMinutes = Math.max(1, Math.min(24 * 60, input.olderThanMinutes ?? 5));
  const createdBefore = new Date(now.getTime() - olderThanMinutes * 60_000);
  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const maxAccounts = Math.max(1, Math.min(50, input.maxAccounts ?? 20));
  const result: ReconcilePendingEventMapOrdersResult = {
    processed: 0,
    updated: 0,
    consistent: 0,
    skipped: 0,
    errors: [],
    generatedAt: now,
  };

  const contaIds = await dependencies.resolveTargetContaIds({ contaId: input.contaId, maxAccounts });
  for (const contaId of contaIds) {
    const orders = await dependencies.findOrders({ contaId, createdBefore, limit });
    for (const order of orders) {
      result.processed += 1;
      if (!order.asaasPaymentId) {
        result.skipped += 1;
        continue;
      }

      if (order.paymentMethod) {
        result.consistent += 1;
        continue;
      }

      try {
        const reconciled = await dependencies.reconcileOrder({
          contaId,
          userId: null,
          eventId: order.eventId,
          orderId: order.id,
        });
        if (reconciled.updated) {
          result.updated += 1;
        } else {
          result.consistent += 1;
        }
      } catch (error) {
        result.skipped += 1;
        result.errors.push({
          orderId: order.id,
          contaId,
          reason: error instanceof Error ? error.message : String(error),
        });
        logEventsFinance(
          'eventMapOrder.reconcile.job.error',
          {
            contaId,
            eventId: order.eventId,
            orderId: order.id,
            asaasPaymentId: order.asaasPaymentId,
            message: error instanceof Error ? error.message : String(error),
          },
          'warn',
        );
      }
    }
  }

  logEventsFinance('eventMapOrder.reconcile.job', {
    processed: result.processed,
    skipped: result.skipped,
    errors: result.errors.length,
    updated: result.updated > 0,
  });

  return result;
}

export type ReconcilePendingEventMapTicketFulfillmentInput = {
  contaId?: string;
  limit?: number;
  maxAccounts?: number;
  maxAttempts?: number;
  useLock?: boolean;
};

export type ReconcilePendingEventMapTicketFulfillmentResult = {
  processed: number;
  issued: number;
  skipped: number;
  errors: Array<{ orderId: string; contaId: string; reason: string }>;
  generatedAt: Date;
  skippedDueToLock?: boolean;
};

type EventMapTicketFulfillmentCandidate = {
  id: string;
  contaId: string;
  asaasPaymentId: string;
  totalAmount: number;
  paymentStatus: string | null;
  paidAt: Date | null;
  ticketFulfillmentStatus: EventMapTicketFulfillmentStatusValue;
  ticketFulfillmentAttempts: number;
};

type ReconcilePendingEventMapTicketFulfillmentDependencies = {
  resolveTargetContaIds: (input: {
    contaId?: string;
    maxAccounts: number;
    maxAttempts: number;
  }) => Promise<string[]>;
  findOrders: (input: {
    contaId: string;
    limit: number;
    maxAttempts: number;
  }) => Promise<EventMapTicketFulfillmentCandidate[]>;
  fulfillOrder: (input: EventMapTicketFulfillmentCandidate) => Promise<{ ticketsCreated: number }>;
  recordFailure: (input: { contaId: string; orderId: string; reason: string }) => Promise<void>;
};

async function resolveEventMapTicketFulfillmentContaIds(input: {
  contaId?: string;
  maxAccounts: number;
  maxAttempts: number;
}): Promise<string[]> {
  if (input.contaId) return [input.contaId];

  const orders = await prisma.eventMapOrder.findMany({
    where: {
      status: 'CONFIRMED',
      ticketFulfillmentStatus: { in: ['PENDING', 'FAILED'] },
      asaasPaymentId: { not: null },
      ticketFulfillmentAttempts: { lt: input.maxAttempts },
    },
    select: { contaId: true },
    distinct: ['contaId'],
    orderBy: { updatedAt: 'asc' },
    take: input.maxAccounts,
  });

  return orders.map((order) => order.contaId);
}

const defaultReconcilePendingEventMapTicketFulfillmentDependencies = {
  resolveTargetContaIds: resolveEventMapTicketFulfillmentContaIds,
  findOrders: async (input: {
    contaId: string;
    limit: number;
    maxAttempts: number;
  }) => {
    const orders = await prisma.eventMapOrder.findMany({
      where: {
        contaId: input.contaId,
        status: 'CONFIRMED',
        ticketFulfillmentStatus: { in: ['PENDING', 'FAILED'] },
        asaasPaymentId: { not: null },
        ticketFulfillmentAttempts: { lt: input.maxAttempts },
      },
      select: {
        id: true,
        contaId: true,
        asaasPaymentId: true,
        totalAmount: true,
        paymentStatus: true,
        paidAt: true,
        ticketFulfillmentStatus: true,
        ticketFulfillmentAttempts: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: input.limit,
    });

    return orders.flatMap((order) => order.asaasPaymentId ? [{
      ...order,
      asaasPaymentId: order.asaasPaymentId,
      totalAmount: Number(order.totalAmount),
    }] : []);
  },
  fulfillOrder: async (input: EventMapTicketFulfillmentCandidate) => {
    const result = await confirmPublicEventMapOrderPayment({
      contaId: input.contaId,
      asaasPaymentId: input.asaasPaymentId,
      externalReference: `event-map-order:${input.id}`,
      paymentStatus: input.paymentStatus,
      paidAt: input.paidAt,
      paidAmount: input.totalAmount,
    });
    return { ticketsCreated: result?.ticketsCreated ?? 0 };
  },
  recordFailure: async (input: { contaId: string; orderId: string; reason: string }) => {
    await recordPublicOrderTicketFulfillmentFailure(input);
  },
} satisfies ReconcilePendingEventMapTicketFulfillmentDependencies;

export async function reconcilePendingEventMapTicketFulfillment(
  input: ReconcilePendingEventMapTicketFulfillmentInput = {},
  dependencies: ReconcilePendingEventMapTicketFulfillmentDependencies = defaultReconcilePendingEventMapTicketFulfillmentDependencies,
): Promise<ReconcilePendingEventMapTicketFulfillmentResult> {
  const run = async () => {
    const maxAccounts = Math.max(1, Math.min(50, input.maxAccounts ?? 20));
    const limit = Math.max(1, Math.min(500, input.limit ?? 100));
    const maxAttempts = Math.max(1, Math.min(50, input.maxAttempts ?? 10));
    const result: ReconcilePendingEventMapTicketFulfillmentResult = {
      processed: 0,
      issued: 0,
      skipped: 0,
      errors: [],
      generatedAt: new Date(),
    };

    const contaIds = await dependencies.resolveTargetContaIds({ contaId: input.contaId, maxAccounts, maxAttempts });
    for (const contaId of contaIds) {
      const orders = await dependencies.findOrders({ contaId, limit, maxAttempts });
      for (const order of orders) {
        result.processed += 1;
        try {
          const fulfilled = await dependencies.fulfillOrder(order);
          if (fulfilled.ticketsCreated > 0) {
            result.issued += 1;
          } else {
            result.skipped += 1;
          }
        } catch (error) {
          result.skipped += 1;
          const reason = error instanceof Error ? error.message : String(error);
          result.errors.push({ orderId: order.id, contaId, reason });
          await dependencies.recordFailure({ contaId, orderId: order.id, reason }).catch(() => null);
          logEventsFinance(
            'eventMapOrder.ticketFulfillment.job.error',
            { contaId, orderId: order.id, asaasPaymentId: order.asaasPaymentId, reason },
            'warn',
          );
        }
      }
    }

    logEventsFinance('eventMapOrder.ticketFulfillment.job', {
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors.length,
      message: `tickets_issued=${result.issued}`,
    });

    return result;
  };

  const useLock = input.useLock ?? dependencies === defaultReconcilePendingEventMapTicketFulfillmentDependencies;
  if (!useLock) return run();

  const locked = await withWebhookJobLock(
    `events-fulfill-tickets:${input.contaId ?? 'global'}`,
    run,
    { ttlMs: 10 * 60_000 },
  );
  if (!locked.acquired) {
    return {
      processed: 0,
      issued: 0,
      skipped: 0,
      errors: [],
      generatedAt: new Date(),
      skippedDueToLock: true,
    };
  }

  return locked.result;
}

export type EventFinancialInconsistencyType =
  | 'CONFIRMED_ORDER_WITHOUT_TICKET'
  | 'CONFIRMED_ORDER_WITH_UNSOLD_SEAT'
  | 'PENDING_ORDER_WITHOUT_PAYMENT'
  | 'ORDER_WITH_PAYMENT_WITHOUT_METHOD'
  | 'EXPIRED_RESERVATION_HOLDING_SEAT';

export type EventFinancialInconsistency = {
  type: EventFinancialInconsistencyType;
  severity: 'warning' | 'critical';
  contaId: string;
  eventId: string;
  orderId?: string;
  reservationId?: string;
  message: string;
};

export type InspectableEventMapOrder = {
  id: string;
  contaId: string;
  eventId: string;
  status: EventMapOrderStatusValue;
  asaasPaymentId: string | null;
  paymentMethod: string | null;
  ticketCount: number;
  items: Array<{
    publicSeat: {
      status: EventMapPublicSeatStatusValue;
    };
  }>;
  reservation: {
    id: string;
    status: EventMapReservationStatusValue;
    expiresAt: Date;
    seats: Array<{
      publicSeat: {
        status: EventMapPublicSeatStatusValue;
      };
    }>;
  } | null;
};

type RawInspectableEventMapOrder = {
  id: string;
  contaId: string;
  eventId: string;
  status: EventMapOrderStatusValue;
  asaasPaymentId: string | null;
  paymentMethod: string | null;
  items: Array<{
    publicSeat: {
      status: EventMapPublicSeatStatusValue;
    };
  }>;
  reservation: {
    id: string;
    status: EventMapReservationStatusValue;
    expiresAt: Date;
    seats: Array<{
      publicSeat: {
        status: EventMapPublicSeatStatusValue;
      };
    }>;
  } | null;
  _count: {
    tickets: number;
  };
};

export function classifyEventMapOrderInconsistencies(
  order: InspectableEventMapOrder,
  now = new Date(),
): EventFinancialInconsistency[] {
  const findings: EventFinancialInconsistency[] = [];

  if (order.status === 'CONFIRMED' && order.ticketCount === 0) {
    findings.push({
      type: 'CONFIRMED_ORDER_WITHOUT_TICKET',
      severity: 'critical',
      contaId: order.contaId,
      eventId: order.eventId,
      orderId: order.id,
      message: 'Pedido confirmado sem ingresso emitido.',
    });
  }

  if (order.status === 'CONFIRMED' && order.items.some((item) => item.publicSeat.status !== 'SOLD')) {
    findings.push({
      type: 'CONFIRMED_ORDER_WITH_UNSOLD_SEAT',
      severity: 'critical',
      contaId: order.contaId,
      eventId: order.eventId,
      orderId: order.id,
      message: 'Pedido confirmado com assento que não está vendido.',
    });
  }

  if (order.status === 'PAYMENT_PENDING' && !order.asaasPaymentId) {
    findings.push({
      type: 'PENDING_ORDER_WITHOUT_PAYMENT',
      severity: 'warning',
      contaId: order.contaId,
      eventId: order.eventId,
      orderId: order.id,
      message: 'Pedido pendente sem cobrança vinculada.',
    });
  }

  if (order.asaasPaymentId && !order.paymentMethod) {
    findings.push({
      type: 'ORDER_WITH_PAYMENT_WITHOUT_METHOD',
      severity: 'warning',
      contaId: order.contaId,
      eventId: order.eventId,
      orderId: order.id,
      message: 'Pedido com cobrança Asaas sem forma de pagamento local.',
    });
  }

  if (
    order.reservation?.status === 'HELD' &&
    order.reservation.expiresAt < now &&
    order.reservation.seats.some((seat) => seat.publicSeat.status === 'HELD')
  ) {
    findings.push({
      type: 'EXPIRED_RESERVATION_HOLDING_SEAT',
      severity: 'warning',
      contaId: order.contaId,
      eventId: order.eventId,
      orderId: order.id,
      reservationId: order.reservation.id,
      message: 'Reserva vencida ainda está segurando assento.',
    });
  }

  return findings;
}

export type InspectEventFinancialInconsistenciesInput = {
  contaId?: string;
  now?: Date;
  limit?: number;
  maxAccounts?: number;
  useLock?: boolean;
};

export type InspectEventFinancialInconsistenciesResult = {
  inspected: number;
  findings: EventFinancialInconsistency[];
  generatedAt: Date;
  skippedDueToLock?: boolean;
};

type InspectEventFinancialInconsistenciesDependencies = {
  resolveTargetContaIds: (input: { contaId?: string; maxAccounts: number }) => Promise<string[]>;
  findOrders: (input: { contaId: string; limit: number }) => Promise<InspectableEventMapOrder[]>;
};

function mapInspectableOrder(order: RawInspectableEventMapOrder): InspectableEventMapOrder {
  return {
    id: order.id,
    contaId: order.contaId,
    eventId: order.eventId,
    status: order.status,
    asaasPaymentId: order.asaasPaymentId,
    paymentMethod: order.paymentMethod,
    ticketCount: order._count.tickets,
    items: order.items.map((item) => ({
      publicSeat: { status: item.publicSeat.status },
    })),
    reservation: order.reservation
      ? {
          id: order.reservation.id,
          status: order.reservation.status,
          expiresAt: order.reservation.expiresAt,
          seats: order.reservation.seats.map((seat) => ({
            publicSeat: { status: seat.publicSeat.status },
          })),
        }
      : null,
  };
}

const defaultInspectEventFinancialInconsistenciesDependencies = {
  resolveTargetContaIds: resolveEventMapContaIds,
  findOrders: async (input: { contaId: string; limit: number }) => {
    const orders = await prisma.eventMapOrder.findMany({
      where: {
        contaId: input.contaId,
        OR: [
          { status: { in: ['PAYMENT_PENDING', 'CONFIRMED'] } },
          { asaasPaymentId: { not: null } },
        ],
      },
      include: {
        items: {
          select: {
            publicSeat: { select: { status: true } },
          },
        },
        reservation: {
          select: {
            id: true,
            status: true,
            expiresAt: true,
            seats: {
              select: {
                publicSeat: { select: { status: true } },
              },
            },
          },
        },
        _count: { select: { tickets: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: input.limit,
    });

    return orders.map(mapInspectableOrder);
  },
} satisfies InspectEventFinancialInconsistenciesDependencies;

export async function inspectEventFinancialInconsistencies(
  input: InspectEventFinancialInconsistenciesInput = {},
  dependencies: InspectEventFinancialInconsistenciesDependencies = defaultInspectEventFinancialInconsistenciesDependencies,
): Promise<InspectEventFinancialInconsistenciesResult> {
  const run = () => inspectEventFinancialInconsistenciesUnlocked(input, dependencies);
  const useLock = input.useLock ?? dependencies === defaultInspectEventFinancialInconsistenciesDependencies;
  if (!useLock) return run();

  const locked = await withWebhookJobLock(
    `events-inspect-financial-inconsistencies:${input.contaId ?? 'global'}`,
    run,
    { ttlMs: 10 * 60_000 },
  );

  if (!locked.acquired) {
    return {
      inspected: 0,
      findings: [],
      generatedAt: new Date(),
      skippedDueToLock: true,
    };
  }

  return locked.result;
}

async function inspectEventFinancialInconsistenciesUnlocked(
  input: InspectEventFinancialInconsistenciesInput,
  dependencies: InspectEventFinancialInconsistenciesDependencies,
): Promise<InspectEventFinancialInconsistenciesResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(1000, input.limit ?? 200));
  const maxAccounts = Math.max(1, Math.min(50, input.maxAccounts ?? 20));
  const contaIds = await dependencies.resolveTargetContaIds({ contaId: input.contaId, maxAccounts });
  const findings: EventFinancialInconsistency[] = [];
  let inspected = 0;

  for (const contaId of contaIds) {
    const orders = await dependencies.findOrders({ contaId, limit });
    inspected += orders.length;
    for (const order of orders) {
      findings.push(...classifyEventMapOrderInconsistencies(order, now));
    }
  }

  if (findings.length > 0) {
    logEventsFinance(
      'eventMapOrder.financialInconsistencies.inspect',
      {
        processed: inspected,
        errors: findings.length,
      },
      'warn',
    );
  }

  return {
    inspected,
    findings,
    generatedAt: now,
  };
}
