import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createStandaloneChargeMock } = vi.hoisted(() => ({
  createStandaloneChargeMock: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  createStandaloneCharge: createStandaloneChargeMock,
}));

import { processRenewalOutbox } from './renewal-outbox.service';

function buildEvent() {
  return {
    id: 'renewal-event-1',
    contaId: 'conta-a',
    processoId: 'process-1',
    eventType: 'UNSUPPORTED_EVENT',
    payload: {},
    status: 'PENDING',
    attempts: 1,
    availableAt: new Date('2026-08-13T10:00:00.000Z'),
    lockedAt: null,
    leaseExpiresAt: null,
    lockToken: null,
    processedAt: null,
    lastError: null,
    dedupeKey: 'renewal-1',
    createdAt: new Date('2026-08-13T09:00:00.000Z'),
    updatedAt: new Date('2026-08-13T09:00:00.000Z'),
  };
}

describe('renewal outbox leases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recupera PROCESSING expirado e não sobrescreve o evento quando perde o fencing token', async () => {
    const prisma = {
      rematriculaOutbox: {
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([buildEvent()]),
      },
    };

    const result = await processRenewalOutbox(
      { contaId: 'conta-a', now: new Date('2026-08-13T10:00:00.000Z'), limit: 1 },
      { prisma } as never,
    );

    expect(result).toEqual([
      expect.objectContaining({
        eventId: 'renewal-event-1',
        status: 'SKIPPED',
        error: 'LEASE_LOST',
      }),
    ]);
    expect(prisma.rematriculaOutbox.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-a',
          status: 'PROCESSING',
          OR: expect.arrayContaining([
            expect.objectContaining({ leaseExpiresAt: expect.objectContaining({ lte: expect.any(Date) }) }),
            expect.objectContaining({ leaseExpiresAt: null }),
          ]),
        }),
      }),
    );
    expect(prisma.rematriculaOutbox.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PROCESSING',
          leaseExpiresAt: expect.any(Date),
          lockToken: expect.any(String),
        }),
      }),
    );
    expect(prisma.rematriculaOutbox.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PROCESSING',
          lockToken: expect.any(String),
        }),
      }),
    );
  });
});
