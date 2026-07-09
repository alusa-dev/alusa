import { describe, expect, it, vi } from 'vitest';
import { StatusMatricula } from '@prisma/client';

import { closeExpiredEnrollmentsWithoutSuccessor } from './enrollment-closure.service';

function buildPrisma(candidates: Array<{ id: string; status: StatusMatricula; dataFimContrato: Date }>) {
  const tx = {
    matricula: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    matriculaLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };

  return {
    tx,
    prisma: {
      matricula: {
        findMany: vi.fn().mockResolvedValue(candidates),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    },
  };
}

describe('closeExpiredEnrollmentsWithoutSuccessor', () => {
  it('marca matriculas vencidas sem sucessora como ENCERRADA', async () => {
    const now = new Date('2026-07-02T12:00:00.000Z');
    const { prisma, tx } = buildPrisma([
      {
        id: 'mat-1',
        status: StatusMatricula.ATIVA,
        dataFimContrato: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);

    const result = await closeExpiredEnrollmentsWithoutSuccessor(
      { contaId: 'conta-1', now },
      { prisma: prisma as never },
    );

    expect(result).toEqual({
      processed: 1,
      closed: [
        {
          matriculaId: 'mat-1',
          previousStatus: StatusMatricula.ATIVA,
          newStatus: StatusMatricula.ENCERRADA,
        },
      ],
    });
    expect(tx.matricula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: StatusMatricula.ENCERRADA,
          statusContrato: 'EXPIRADO',
        }),
      }),
    );
    expect(tx.matriculaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matriculaId: 'mat-1',
          action: 'ENCERRAMENTO_NATURAL',
        }),
      }),
    );
  });

  it('nao registra log quando a atualizacao perdeu a corrida', async () => {
    const now = new Date('2026-07-02T12:00:00.000Z');
    const { prisma, tx } = buildPrisma([
      {
        id: 'mat-1',
        status: StatusMatricula.PAUSADA,
        dataFimContrato: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    tx.matricula.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await closeExpiredEnrollmentsWithoutSuccessor(
      { contaId: 'conta-1', now },
      { prisma: prisma as never },
    );

    expect(result.closed).toHaveLength(0);
    expect(tx.matriculaLog.create).not.toHaveBeenCalled();
  });
});
