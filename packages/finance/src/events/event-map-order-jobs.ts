import { prisma } from '@alusa/database';
import { Prisma } from '@prisma/client';

import { withWebhookJobLock } from '../foundation/webhook-job-lock.service';
import { logEventsFinance } from './events-finance-observability';
import {
  reconcileEventMapOrderPayment,
  type ReconcileEventMapOrderPaymentInput,
  type ReconcileEventMapOrderPaymentResult,
} from './reconcile-event-map-order-payment';

type EventMapPublicSeatStatusValue = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' | 'UNAVAILABLE';
type EventMapReservationStatusValue = 'HELD' | 'EXPIRED' | 'CONSUMED' | 'CANCELLED';
type EventMapOrderStatusValue = 'PAYMENT_PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

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
    _count: {
      tickets: number;
    };
  } | null;
};

export type ExpiredReservationDecision =
  | { expire: true }
  | { expire: false; reason: string };

export function getExpiredReservationDecision(
  reservation: ExpirableEventMapReservationRecord,
  now = new Date(),
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

  if (reservation.order.ticketCount > 0) {
    return { expire: false, reason: 'ticket_already_issued' };
  }

  if (reservation.order.asaasPaymentId) {
    return { expire: false, reason: 'external_payment_requires_reconciliation' };
  }

  return { expire: true };
}

export type ExpireEventMapReservationsInput = {
  contaId?: string;
  now?: Date;
  limit?: number;
  maxAccounts?: number;
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
  }) => Promise<{ expired: boolean; reason?: string }>;
};

function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
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
            _count: { select: { tickets: true } },
          },
        },
      },
      orderBy: { expiresAt: 'asc' },
      take: input.limit,
    });

    return reservations.map(mapReservationRecord);
  },
  expireReservation: async (input: { contaId: string; reservationId: string; now: Date }) => prisma.$transaction(async (tx) => {
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
            _count: { select: { tickets: true } },
          },
        },
      },
    });

    if (!reservation) {
      return { expired: false, reason: 'reservation_not_found' };
    }

    const record = mapReservationRecord(reservation);
    const decision = getExpiredReservationDecision(record, input.now);
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
        return { expired: false, reason: 'seat_not_held' };
      }
    }

    const reservationUpdate = await tx.eventMapReservation.updateMany({
      where: { id: record.id, contaId: input.contaId, status: 'HELD' },
      data: { status: 'EXPIRED', checkoutKey: null, cancelledAt: input.now },
    });

    if (reservationUpdate.count === 0) {
      return { expired: false, reason: 'reservation_not_held' };
    }

    if (record.order) {
      await tx.eventMapOrder.updateMany({
        where: {
          id: record.order.id,
          contaId: input.contaId,
          status: 'PAYMENT_PENDING',
          asaasPaymentId: null,
        },
        data: {
          status: 'EXPIRED',
          cancelledAt: input.now,
          paymentStatus: 'EXPIRED',
        },
      });
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
        }),
      },
    });

    return { expired: true };
  }),
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
      const decision = getExpiredReservationDecision(reservation, now);
      if (!decision.expire) {
        result.skipped += 1;
        result.errors.push({ reservationId: reservation.id, contaId, reason: decision.reason });
        continue;
      }

      try {
        const expired = await dependencies.expireReservation({ contaId, reservationId: reservation.id, now });
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
