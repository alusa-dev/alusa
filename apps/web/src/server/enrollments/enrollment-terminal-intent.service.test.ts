import { describe, expect, it, vi } from 'vitest';
import { requestEnrollmentTerminalIntent } from './enrollment-terminal-intent.service';

describe('requestEnrollmentTerminalIntent', () => {
  it('marks every tenant-scoped billing sibling so a fee hold cannot leave recurring runnable', async () => {
    const rows = [
      { id: 'fee-outbox', status: 'PENDING', terminalIntent: null, attempts: 0 },
      { id: 'recurring-outbox', status: 'PENDING', terminalIntent: null, attempts: 0 },
    ];
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      matriculaBillingOutbox: {
        findMany: vi.fn().mockResolvedValue(rows.map(({ id }) => ({ id }))),
        findFirst: vi.fn(async ({ where }: { where: { id: string; contaId: string } }) =>
          where.contaId === 'conta-a' ? rows.find((row) => row.id === where.id) ?? null : null,
        ),
        updateMany,
      },
    } as never;

    const result = await requestEnrollmentTerminalIntent({
      db,
      contaId: 'conta-a',
      matriculaId: 'mat-1',
      intent: 'CANCELADA',
      reason: 'Solicitação da escola',
      actorId: 'user-1',
    });

    expect(result).toEqual({ kind: 'CANCELLED', eventId: 'fee-outbox' });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls.map(([call]) => call.where.id)).toEqual(['fee-outbox', 'recurring-outbox']);
    expect(updateMany.mock.calls.every(([call]) => call.where.contaId === 'conta-a')).toBe(true);
  });

  it('retains reconciliation uncertainty while still placing terminal intent on siblings', async () => {
    const rows = [
      { id: 'fee-outbox', status: 'REQUIRES_RECONCILIATION', terminalIntent: null, attempts: 1 },
      { id: 'recurring-outbox', status: 'PENDING', terminalIntent: null, attempts: 0 },
    ];
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      matriculaBillingOutbox: {
        findMany: vi.fn().mockResolvedValue(rows.map(({ id }) => ({ id }))),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null),
        updateMany,
      },
    } as never;

    await expect(requestEnrollmentTerminalIntent({
      db,
      contaId: 'conta-a',
      matriculaId: 'mat-1',
      intent: 'CANCELADA',
      reason: 'Solicitação da escola',
      actorId: 'user-1',
    })).resolves.toEqual({ kind: 'RECONCILIATION_REQUIRED', eventId: 'fee-outbox' });
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
