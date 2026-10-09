import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '../../prisma';
import { lockPublicEventMapReservation } from './event-map.service';

describe('lockPublicEventMapReservation', () => {
  it('serializes transactions for the same tenant reservation in PostgreSQL', async () => {
    const input = { contaId: `test-${randomUUID()}`, reservationId: randomUUID() };
    let releaseFirst!: () => void;
    let markFirstAcquired!: () => void;
    let markSecondWaiting!: () => void;
    const firstAcquired = new Promise<void>((resolve) => { markFirstAcquired = resolve; });
    const releaseGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondWaiting = new Promise<void>((resolve) => { markSecondWaiting = resolve; });

    const first = prisma.$transaction(async (tx) => {
      await lockPublicEventMapReservation(tx, input);
      markFirstAcquired();
      await releaseGate;
    });
    await firstAcquired;

    let secondAcquired = false;
    const second = prisma.$transaction(async (tx) => {
      markSecondWaiting();
      await lockPublicEventMapReservation(tx, input);
      secondAcquired = true;
    });

    try {
      await secondWaiting;
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(secondAcquired).toBe(false);
    } finally {
      releaseFirst();
      await Promise.all([first, second]);
    }

    expect(secondAcquired).toBe(true);
  }, 15_000);
});
