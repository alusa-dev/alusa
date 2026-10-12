import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { $transaction: vi.fn() },
}));

vi.mock('@/src/prisma', () => ({ prisma: prismaMock }));

import {
  assertCalendarResourcesBelongToConta,
  withCalendarEventWriteLock,
} from './calendar-core.service';

describe('calendar write guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects any referenced resource outside the tenant', async () => {
    const client = {
      turma: { findFirst: vi.fn().mockResolvedValue({ id: 'turma-1' }) },
      sala: { findFirst: vi.fn().mockResolvedValue({ id: 'sala-1' }) },
      professor: { findMany: vi.fn().mockResolvedValue([{ id: 'prof-1' }]) },
    } as never;

    await expect(assertCalendarResourcesBelongToConta({
      contaId: 'conta-a', turmaId: 'turma-1', salaId: 'sala-1', professorIds: ['prof-1', 'prof-2'],
      prismaClient: client,
    })).rejects.toMatchObject({ code: 'RECURSO_AGENDA_INVALIDO' });
  });

  it('holds the tenant advisory lock until each serialized writer finishes', async () => {
    let tail = Promise.resolve();
    const releases: Array<() => void> = [];
    const lock = vi.fn(async () => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      return release;
    });
    const executeRaw = vi.fn(async (_query: TemplateStringsArray, _contaId: string) => {
      releases.push(await lock());
    });
    const tx = { $executeRaw: executeRaw };
    prismaMock.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    let active = 0;
    let maxActive = 0;

    const writer = () => withCalendarEventWriteLock('conta-a', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      releases.shift()?.();
    });

    await Promise.all([writer(), writer()]);

    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(Array.from(executeRaw.mock.calls[0]?.[0] ?? []).join('')).toContain('pg_advisory_xact_lock');
    expect(executeRaw.mock.calls[0]?.[1]).toBe('conta-a');
    expect(maxActive).toBe(1);
  });

  it('rolls back the transaction when a linked write or operation log fails', async () => {
    const persisted: string[] = [];
    const tx = { $executeRaw: vi.fn(), addEvent: () => persisted.push('event'), addLinkedState: () => persisted.push('linked') };
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
      const pending: string[] = [];
      const transactionalClient = {
        $executeRaw: tx.$executeRaw,
        addEvent: () => pending.push('event'),
        addLinkedState: () => pending.push('linked'),
      };
      const result = await callback(transactionalClient);
      persisted.push(...pending);
      return result;
    });

    await expect(withCalendarEventWriteLock('conta-a', async (client) => {
      const transactionalClient = client as unknown as { addEvent: () => void; addLinkedState: () => void };
      transactionalClient.addEvent();
      transactionalClient.addLinkedState();
      throw new Error('operation log failed');
    })).rejects.toThrow('operation log failed');

    expect(persisted).toEqual([]);
  });
});
