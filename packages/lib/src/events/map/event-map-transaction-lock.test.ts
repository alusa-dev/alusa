import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '../../prisma';
import { lockPublicEventMapReservation } from './event-map.service';

describe('lockPublicEventMapReservation', () => {
  it('serializes transactions for the same tenant reservation in PostgreSQL', async () => {
    const runId = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Map lock ${runId}` } });
    const event = await prisma.schoolEvent.create({
      data: {
        contaId: conta.id,
        name: `Map lock ${runId}`,
        type: 'CULTURAL_SHOW',
        startsAt: new Date(),
      },
    });
    const map = await prisma.eventMap.create({
      data: { contaId: conta.id, eventId: event.id, name: `Map lock ${runId}` },
    });
    const version = await prisma.eventMapVersion.create({
      data: {
        contaId: conta.id,
        eventMapId: map.id,
        version: 1,
        status: 'PUBLISHED',
        snapshot: {},
      },
    });
    const reservation = await prisma.eventMapReservation.create({
      data: {
        contaId: conta.id,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        holdToken: `map-lock-${runId}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const input = { contaId: conta.id, reservationId: reservation.id };
    let releaseFirst!: () => void;
    let markFirstAcquired!: () => void;
    let markSecondPid!: (pid: number) => void;
    const firstAcquired = new Promise<void>((resolve) => { markFirstAcquired = resolve; });
    const releaseGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondPidPromise = new Promise<number>((resolve) => { markSecondPid = resolve; });

    let secondAcquired = false;
    try {
      const first = prisma.$transaction(async (tx) => {
        await lockPublicEventMapReservation(tx, input);
        markFirstAcquired();
        await releaseGate;
      });
      await firstAcquired;

      const second = prisma.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        markSecondPid(pid);
        await lockPublicEventMapReservation(tx, input);
        secondAcquired = true;
      });

      const secondPid = await secondPidPromise;
      const deadline = Date.now() + 2_000;
      let blockedByFirst = false;
      while (Date.now() < deadline) {
        const [activity] = await prisma.$queryRaw<Array<{ blockedBy: number[] }>>`
          SELECT pg_blocking_pids(${secondPid}::int) AS "blockedBy"
        `;
        if ((activity?.blockedBy.length ?? 0) > 0) {
          blockedByFirst = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blockedByFirst).toBe(true);
      expect(secondAcquired).toBe(false);

      releaseFirst();
      await Promise.all([first, second]);
      expect(secondAcquired).toBe(true);
    } finally {
      releaseFirst();
      await prisma.eventMapReservation.deleteMany({ where: { contaId: conta.id, id: reservation.id } });
      await prisma.eventMapVersion.deleteMany({ where: { contaId: conta.id, id: version.id } });
      await prisma.eventMap.deleteMany({ where: { contaId: conta.id, id: map.id } });
      await prisma.schoolEvent.deleteMany({ where: { contaId: conta.id, id: event.id } });
      await prisma.conta.deleteMany({ where: { id: conta.id } });
    }
  }, 15_000);
});
