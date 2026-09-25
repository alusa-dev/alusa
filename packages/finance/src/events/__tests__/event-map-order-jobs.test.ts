import { describe, expect, it } from 'vitest';

import {
  classifyEventMapOrderInconsistencies,
  expireEventMapReservations,
  getExpiredReservationDecision,
  inspectEventFinancialInconsistencies,
  reconcilePendingEventMapOrders,
  reconcilePendingEventMapTicketFulfillment,
  type ExpirableEventMapReservationRecord,
  type InspectableEventMapOrder,
} from '../event-map-order-jobs';

const now = new Date('2026-01-10T12:00:00.000Z');

function reservation(
  overrides: Partial<ExpirableEventMapReservationRecord> = {},
): ExpirableEventMapReservationRecord {
  return {
    id: 'reservation-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    eventMapId: 'map-1',
    status: 'HELD',
    expiresAt: new Date('2026-01-10T10:00:00.000Z'),
    seats: [{ publicSeatId: 'seat-1', publicSeat: { status: 'HELD' } }],
    order: {
      id: 'order-1',
      status: 'PAYMENT_PENDING',
      asaasPaymentId: null,
      paymentStatus: null,
      updatedAt: now,
      ticketCount: 0,
    },
    ...overrides,
  };
}

function order(overrides: Partial<InspectableEventMapOrder> = {}): InspectableEventMapOrder {
  return {
    id: 'order-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    status: 'PAYMENT_PENDING',
    asaasPaymentId: null,
    paymentMethod: null,
    ticketCount: 0,
    items: [],
    reservation: null,
    ...overrides,
  };
}

describe('getExpiredReservationDecision', () => {
  it('allows expiring a stale pending reservation without external payment or tickets', () => {
    expect(getExpiredReservationDecision(reservation(), now)).toEqual({ expire: true });
  });

  it('does not expire reservations that are still valid', () => {
    expect(getExpiredReservationDecision(reservation({ expiresAt: new Date('2026-01-10T13:00:00.000Z') }), now))
      .toEqual({ expire: false, reason: 'reservation_not_expired' });
  });

  it('does not release sold seats', () => {
    expect(getExpiredReservationDecision(reservation({
      seats: [{ publicSeatId: 'seat-1', publicSeat: { status: 'SOLD' } }],
    }), now)).toEqual({ expire: false, reason: 'seat_not_held' });
  });

  it('does not expire orders with external payment before reconciliation', () => {
    expect(getExpiredReservationDecision(reservation({
      order: {
        id: 'order-1',
        status: 'PAYMENT_PENDING',
        asaasPaymentId: 'pay-1',
        paymentStatus: 'PENDING',
        ticketCount: 0,
      },
    }), now)).toEqual({ expire: false, reason: 'external_payment_requires_reconciliation' });
  });

  it('preserves holds when remote payment creation has an uncertain result', () => {
    const uncertain = reservation({
      order: {
        id: 'order-1',
        status: 'PAYMENT_PENDING',
        asaasPaymentId: null,
        paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
        ticketCount: 0,
      },
    });
    expect(getExpiredReservationDecision(uncertain, now)).toEqual({
      expire: false,
      reason: 'external_payment_requires_reconciliation',
    });
    expect(getExpiredReservationDecision(uncertain, now, { noRemotePaymentConfirmed: true })).toEqual({
      expire: true,
    });
  });

  it('allows expiring an uncertain creation after the discovered remote charge is confirmed deleted', () => {
    const uncertain = reservation({
      order: {
        id: 'order-1',
        status: 'PAYMENT_PENDING',
        asaasPaymentId: null,
        paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
        ticketCount: 0,
      },
    });

    expect(getExpiredReservationDecision(uncertain, now, { deletedAsaasPaymentId: 'pay-discovered' }))
      .toEqual({ expire: true });
  });
});

describe('expireEventMapReservations', () => {
  it('limits Asaas reconciliation calls to the configured per-run budget', async () => {
    let providerChecks = 0;
    const expired = [
      reservation({ id: 'reservation-1', order: { ...reservation().order!, asaasPaymentId: 'pay-1' } }),
      reservation({ id: 'reservation-2', order: { ...reservation().order!, asaasPaymentId: 'pay-2' } }),
    ];
    const dependencies = {
      resolveTargetContaIds: async () => ['conta-1'],
      findExpiredReservations: async () => expired,
      expireReservation: async () => ({ expired: false, reason: 'not_expired' }),
      resolveExternalPaymentAtExpiry: async () => {
        providerChecks += 1;
        return { decision: 'NOT_CANCELLABLE' as const };
      },
    };

    const result = await expireEventMapReservations(
      { contaId: 'conta-1', now, limit: 10, maxExternalPaymentChecks: 1, useLock: false },
      dependencies,
    );

    expect(providerChecks).toBe(1);
    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(2);
  });

  it('keeps seats held when an aged payment creation remains unknown after provider lookup', async () => {
    let expireCalls = 0;
    const unresolved = reservation({
      order: {
        id: 'order-unknown',
        status: 'PAYMENT_PENDING',
        asaasPaymentId: null,
        paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
        updatedAt: new Date(now.getTime() - 60 * 60_000),
        ticketCount: 0,
      },
    });
    const result = await expireEventMapReservations({
      contaId: 'conta-1',
      now,
      useLock: false,
    }, {
      resolveTargetContaIds: async () => ['conta-1'],
      findExpiredReservations: async () => [unresolved],
      resolveExternalPaymentAtExpiry: async ({ paymentCreationUnresolved }) => {
        expect(paymentCreationUnresolved).toBe(true);
        return { decision: 'NOT_CANCELLABLE' };
      },
      expireReservation: async () => {
        expireCalls += 1;
        return { expired: true };
      },
    });

    expect(result.expired).toBe(0);
    expect(result.skipped).toBe(1);
    expect(expireCalls).toBe(0);
  });

  it('expires eligible reservations and is safe to run again', async () => {
    const expiredIds = new Set<string>();
    const target = reservation();
    const dependencies = {
      resolveTargetContaIds: async () => ['conta-1'],
      findExpiredReservations: async () => expiredIds.has(target.id) ? [] : [target],
      expireReservation: async (input: { reservationId: string }) => {
        if (expiredIds.has(input.reservationId)) return { expired: false, reason: 'already_expired' };
        expiredIds.add(input.reservationId);
        return { expired: true };
      },
    };

    const first = await expireEventMapReservations({ contaId: 'conta-1', now, useLock: false }, dependencies);
    const second = await expireEventMapReservations({ contaId: 'conta-1', now, useLock: false }, dependencies);

    expect(first.expired).toBe(1);
    expect(first.processed).toBe(1);
    expect(second.expired).toBe(0);
    expect(second.processed).toBe(0);
  });

  it('skips confirmed orders and keeps history untouched', async () => {
    const dependencies = {
      resolveTargetContaIds: async () => ['conta-1'],
      findExpiredReservations: async () => [reservation({
        order: {
          id: 'order-1',
          status: 'CONFIRMED',
          asaasPaymentId: 'pay-1',
          paymentStatus: 'RECEIVED',
          paidAt: now,
          ticketCount: 1,
        },
      })],
      expireReservation: async () => ({ expired: true }),
    };

    const result = await expireEventMapReservations({ contaId: 'conta-1', now, useLock: false }, dependencies);

    expect(result.expired).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]?.reason).toBe('order_not_pending');
  });
});

describe('reconcilePendingEventMapOrders', () => {
  it('reconciles missing payment method without confirming payment status', async () => {
    const calls: string[] = [];
    const dependencies = {
      resolveTargetContaIds: async () => ['conta-1'],
      findOrders: async () => [{
        id: 'order-1',
        contaId: 'conta-1',
        eventId: 'event-1',
        asaasPaymentId: 'pay-1',
        paymentMethod: null,
      }],
      reconcileOrder: async (input: { orderId: string }) => {
        calls.push(input.orderId);
        return {
          ok: true as const,
          updated: true,
          orderId: input.orderId,
          asaasPaymentId: 'pay-1',
          previousPaymentMethod: null,
          paymentMethod: 'PIX',
        };
      },
    };

    const result = await reconcilePendingEventMapOrders({
      contaId: 'conta-1',
      now,
      useLock: false,
    }, dependencies);

    expect(calls).toEqual(['order-1']);
    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('keeps processing other orders when Asaas reconciliation fails', async () => {
    const dependencies = {
      resolveTargetContaIds: async () => ['conta-1'],
      findOrders: async () => [
        {
          id: 'order-1',
          contaId: 'conta-1',
          eventId: 'event-1',
          asaasPaymentId: 'pay-1',
          paymentMethod: null,
        },
        {
          id: 'order-2',
          contaId: 'conta-1',
          eventId: 'event-1',
          asaasPaymentId: 'pay-2',
          paymentMethod: null,
        },
      ],
      reconcileOrder: async (input: { orderId: string }) => {
        if (input.orderId === 'order-1') throw new Error('asaas unavailable');
        return {
          ok: true as const,
          updated: false,
          orderId: input.orderId,
          asaasPaymentId: 'pay-2',
          previousPaymentMethod: null,
          paymentMethod: null,
        };
      },
    };

    const result = await reconcilePendingEventMapOrders({
      contaId: 'conta-1',
      now,
      useLock: false,
    }, dependencies);

    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.consistent).toBe(1);
    expect(result.errors[0]?.orderId).toBe('order-1');
  });
});

describe('reconcilePendingEventMapTicketFulfillment', () => {
  it('emits tickets automatically and records failures without stopping the batch', async () => {
    const fulfilled: string[] = [];
    const failures: Array<{ orderId: string; reason: string }> = [];
    const dependencies = {
      resolveTargetContaIds: async () => ['conta-1'],
      findOrders: async () => [
        {
          id: 'order-1',
          contaId: 'conta-1',
          asaasPaymentId: 'pay-1',
          paymentStatus: 'RECEIVED',
          ticketFulfillmentStatus: 'FAILED' as const,
          ticketFulfillmentAttempts: 1,
        },
        {
          id: 'order-2',
          contaId: 'conta-1',
          asaasPaymentId: 'pay-2',
          paymentStatus: 'RECEIVED',
          paidAt: now,
          ticketFulfillmentStatus: 'FAILED' as const,
          ticketFulfillmentAttempts: 1,
        },
      ],
      fulfillOrder: async (order: { id: string }) => {
        if (order.id === 'order-2') throw new Error('reserva indisponível');
        fulfilled.push(order.id);
        return { ticketsCreated: 2 };
      },
      recordFailure: async (input: { orderId: string; reason: string }) => {
        failures.push(input);
      },
    };

    const result = await reconcilePendingEventMapTicketFulfillment(
      { contaId: 'conta-1', useLock: false },
      dependencies,
    );

    expect(result).toMatchObject({ processed: 2, issued: 1, skipped: 1 });
    expect(fulfilled).toEqual(['order-1']);
    expect(failures).toEqual([{ contaId: 'conta-1', orderId: 'order-2', reason: 'reserva indisponível' }]);
  });

  it('returns an empty result when there are no pending fulfillment orders', async () => {
    const resolverInputs: Array<{ contaId?: string; maxAccounts: number; maxAttempts: number }> = [];
    const dependencies = {
      resolveTargetContaIds: async (input: { contaId?: string; maxAccounts: number; maxAttempts: number }) => {
        resolverInputs.push(input);
        return ['conta-1'];
      },
      findOrders: async () => [],
      fulfillOrder: async () => ({ ticketsCreated: 1 }),
      recordFailure: async () => undefined,
    };

    const result = await reconcilePendingEventMapTicketFulfillment(
      { contaId: 'conta-1', useLock: false },
      dependencies,
    );

    expect(result.processed).toBe(0);
    expect(resolverInputs).toEqual([{ contaId: 'conta-1', maxAccounts: 20, maxAttempts: 10 }]);
  });
});

describe('inspectEventFinancialInconsistencies', () => {
  it('classifies paid orders without ticket and confirmed orders with unsold seat', () => {
    const findings = classifyEventMapOrderInconsistencies(order({
      status: 'CONFIRMED',
      ticketCount: 0,
      items: [{ publicSeat: { status: 'HELD' } }],
    }), now);

    expect(findings.map((finding) => finding.type)).toEqual([
      'CONFIRMED_ORDER_WITHOUT_TICKET',
      'CONFIRMED_ORDER_WITH_UNSOLD_SEAT',
    ]);
  });

  it('classifies pending orders without charge and orders missing payment method', () => {
    const findings = classifyEventMapOrderInconsistencies(order({
      status: 'PAYMENT_PENDING',
      asaasPaymentId: 'pay-1',
      paymentMethod: null,
    }), now);

    expect(findings.map((finding) => finding.type)).toEqual(['ORDER_WITH_PAYMENT_WITHOUT_METHOD']);

    expect(classifyEventMapOrderInconsistencies(order(), now).map((finding) => finding.type))
      .toEqual(['PENDING_ORDER_WITHOUT_PAYMENT']);
  });

  it('returns no findings for consistent scenarios', async () => {
    const dependencies = {
      resolveTargetContaIds: async () => ['conta-1'],
      findOrders: async () => [order({
        status: 'CONFIRMED',
        asaasPaymentId: 'pay-1',
        paymentMethod: 'PIX',
        ticketCount: 1,
        items: [{ publicSeat: { status: 'SOLD' } }],
      })],
    };

    const result = await inspectEventFinancialInconsistencies({
      contaId: 'conta-1',
      now,
      useLock: false,
    }, dependencies);

    expect(result.inspected).toBe(1);
    expect(result.findings).toHaveLength(0);
  });
});
