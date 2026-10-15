import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  usuario: { findFirst: vi.fn() },
  contratoModelo: { findFirst: vi.fn() },
  schoolEvent: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
}));

vi.mock('../prisma', () => ({ prisma: db }));
vi.mock('./event-audit.service', () => ({ recordEventAudit: vi.fn() }));

import { createSchoolEvent, updateSchoolEvent } from './events.service';
import { createSchoolEventSchema, updateSchoolEventSchema } from './events.schema';

const ctx = { contaId: 'tenant-a', userId: 'actor-a' };
const createInput = createSchoolEventSchema.parse({
  name: 'Evento', type: 'OTHER', startsAt: '2026-10-01T12:00:00.000Z', responsibleUserId: 'responsible-a',
});
const updateInput = updateSchoolEventSchema.parse({ responsibleUserId: 'responsible-a' });

describe('event responsible user tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
    db.usuario.findFirst.mockResolvedValue(null);
    db.schoolEvent.findFirst.mockResolvedValue({ id: 'event-a', status: 'ACTIVE', hasTickets: false, ticketMode: 'NONE' });
  });

  it('rejects an unrelated or inactive user before create/update writes', async () => {
    await expect(createSchoolEvent(ctx, createInput)).rejects.toMatchObject({
      code: 'RESPONSAVEL_NAO_ENCONTRADO', status: 422,
    });
    expect(db.schoolEvent.create).not.toHaveBeenCalled();

    await expect(updateSchoolEvent(ctx, 'event-a', updateInput)).rejects.toMatchObject({
      code: 'RESPONSAVEL_NAO_ENCONTRADO', status: 422,
    });
    expect(db.schoolEvent.update).not.toHaveBeenCalled();
    expect(db.usuario.findFirst).toHaveBeenCalledTimes(2);
    for (const [args] of db.usuario.findFirst.mock.calls) {
      expect(args.where).toEqual({ id: 'responsible-a', status: 'ATIVO' });
      expect(args.select).toEqual({ id: true, contaId: true, acessosConta: { select: { contaId: true, status: true } } });
    }
  });

  it('rejects a legacy account owner when any membership exists but none is active for this tenant', async () => {
    db.usuario.findFirst.mockResolvedValue({
      id: 'responsible-a', contaId: 'tenant-a', acessosConta: [{ contaId: 'tenant-b', status: 'ATIVO' }],
    });

    await expect(createSchoolEvent(ctx, createInput)).rejects.toMatchObject({ code: 'RESPONSAVEL_NAO_ENCONTRADO', status: 422 });
    expect(db.schoolEvent.create).not.toHaveBeenCalled();

    await expect(updateSchoolEvent(ctx, 'event-a', updateInput)).rejects.toMatchObject({ code: 'RESPONSAVEL_NAO_ENCONTRADO', status: 422 });
    expect(db.schoolEvent.update).not.toHaveBeenCalled();
  });

  it('allows legacy owners without memberships and active tenant members', async () => {
    db.usuario.findFirst
      .mockResolvedValueOnce({ id: 'responsible-a', contaId: 'tenant-a', acessosConta: [] })
      .mockResolvedValueOnce({ id: 'responsible-a', contaId: 'tenant-b', acessosConta: [{ contaId: 'tenant-a', status: 'ATIVO' }] });
    const writeReached = new Error('write reached');
    db.schoolEvent.create.mockRejectedValue(writeReached);
    await expect(createSchoolEvent(ctx, createInput)).rejects.toBe(writeReached);
    expect(db.schoolEvent.create.mock.calls[0]?.[0].data).toMatchObject({ responsibleUserId: 'responsible-a', contaId: 'tenant-a' });

    db.schoolEvent.update.mockRejectedValue(writeReached);
    await expect(updateSchoolEvent(ctx, 'event-a', updateInput)).rejects.toBe(writeReached);
    expect(db.schoolEvent.update.mock.calls[0]?.[0].data).toMatchObject({ responsibleUserId: 'responsible-a' });
  });
});
