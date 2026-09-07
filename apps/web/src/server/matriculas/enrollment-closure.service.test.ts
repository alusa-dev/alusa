import { describe, expect, it, vi } from 'vitest';
import { StatusMatricula } from '@prisma/client';

import {
  closeExpiredEnrollmentsWithoutSuccessor,
  finalizeExpiredFamilyEnrollments,
} from './enrollment-closure.service';

function buildPrisma(candidates: Array<{
  id: string;
  status: StatusMatricula;
  dataFimContrato: Date;
  contratoAtualId?: string | null;
}>) {
  const tx = {
    contrato: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
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
      conta: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      },
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
        contratoAtualId: 'contrato-1',
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
    expect(tx.contrato.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'contrato-1',
        contaId: 'conta-1',
        status: { notIn: ['EXPIRADO', 'CANCELADO'] },
      },
      data: { status: 'EXPIRADO' },
    });
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

  it('preserva o último dia do contrato e encerra somente no dia acadêmico seguinte', async () => {
    const candidate = {
      id: 'mat-last-day',
      status: StatusMatricula.ATIVA,
      dataFimContrato: new Date('2026-09-07T12:00:00.000Z'),
      contratoAtualId: null,
    };
    const { prisma, tx } = buildPrisma([candidate]);
    vi.mocked(prisma.matricula.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate]);

    const lastDay = await closeExpiredEnrollmentsWithoutSuccessor(
      {
        contaId: 'conta-1',
        now: new Date('2026-09-08T02:59:00.000Z'),
      },
      { prisma: prisma as never },
    );
    const nextDay = await closeExpiredEnrollmentsWithoutSuccessor(
      {
        contaId: 'conta-1',
        now: new Date('2026-09-08T03:01:00.000Z'),
      },
      { prisma: prisma as never },
    );

    expect(lastDay.closed).toHaveLength(0);
    expect(nextDay.closed).toHaveLength(1);
    expect(prisma.matricula.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          dataFimContrato: { lt: new Date('2026-09-07T00:00:00.000Z') },
        }),
      }),
    );
    expect(prisma.matricula.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          dataFimContrato: { lt: new Date('2026-09-08T00:00:00.000Z') },
        }),
      }),
    );
    expect(tx.matriculaLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeExpiredFamilyEnrollments', () => {
  it('encerra o grupo familiar sem assinatura quando todos os membros são terminais', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      matriculaFamiliar: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'family-1',
            dataFimContrato: new Date('2026-07-01T00:00:00.000Z'),
            standaloneSubscriptionId: null,
            matriculas: [
              { id: 'mat-1', status: StatusMatricula.ENCERRADA, rematriculasDerivadas: [] },
              { id: 'mat-2', status: StatusMatricula.CANCELADA, rematriculasDerivadas: [] },
            ],
          },
        ]),
        updateMany,
      },
      familyBillingOutbox: { create: vi.fn() },
    };

    const result = await finalizeExpiredFamilyEnrollments(
      { contaId: 'conta-1', now: new Date('2026-07-02T12:00:00.000Z') },
      { prisma: prisma as never },
    );

    expect(result.finalized).toEqual(['family-1']);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'family-1', contaId: 'conta-1', status: { in: ['ATIVO', 'PARCIAL'] } },
      data: { status: 'CANCELADO', academicStatus: 'COMPLETO' },
    });
  });

  it('não encerra o grupo quando existe uma matrícula sucessora ativa', async () => {
    const updateMany = vi.fn();
    const prisma = {
      matriculaFamiliar: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'family-1',
            dataFimContrato: new Date('2026-07-01T00:00:00.000Z'),
            standaloneSubscriptionId: null,
            matriculas: [
              {
                id: 'mat-1',
                status: StatusMatricula.ENCERRADA,
                rematriculasDerivadas: [{ id: 'future-1' }],
              },
            ],
          },
        ]),
        updateMany,
      },
      familyBillingOutbox: { create: vi.fn() },
    };

    const result = await finalizeExpiredFamilyEnrollments(
      { contaId: 'conta-1', now: new Date('2026-07-02T12:00:00.000Z') },
      { prisma: prisma as never },
    );

    expect(result.finalized).toHaveLength(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('enfileira o encerramento financeiro com chave idempotente', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'outbox-1' });
    const prisma = {
      matriculaFamiliar: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'family-1',
            dataFimContrato: new Date('2026-07-01T00:00:00.000Z'),
            standaloneSubscriptionId: 'sub-local-1',
            matriculas: [{ id: 'mat-1', status: StatusMatricula.ENCERRADA, rematriculasDerivadas: [] }],
          },
        ]),
        updateMany: vi.fn(),
      },
      familyBillingOutbox: { create },
    };

    const result = await finalizeExpiredFamilyEnrollments(
      { contaId: 'conta-1', now: new Date('2026-07-02T12:00:00.000Z') },
      { prisma: prisma as never },
    );

    expect(result.pendingFinancialClosure).toEqual(['family-1']);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'CLOSE_MATRICULA_FAMILIAR_SUBSCRIPTION',
        dedupeKey: 'MATRICULA_FAMILIAR:family-1:CLOSE_SUBSCRIPTION',
        matriculaFamiliarId: 'family-1',
        payload: expect.objectContaining({ effectiveDate: '2026-07-02' }),
      }),
    }));
  });

  it('não finaliza o grupo no último dia e usa o dia da Conta para liberar no seguinte', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const family = {
      id: 'family-last-day',
      dataFimContrato: new Date('2026-09-07T12:00:00.000Z'),
      standaloneSubscriptionId: null,
      matriculas: [{ id: 'mat-1', status: StatusMatricula.ENCERRADA, rematriculasDerivadas: [] }],
    };
    const prisma = {
      conta: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      },
      matriculaFamiliar: {
        findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([family]),
        updateMany,
      },
      familyBillingOutbox: { create: vi.fn() },
    };

    const lastDay = await finalizeExpiredFamilyEnrollments(
      { contaId: 'conta-1', now: new Date('2026-09-08T02:59:00.000Z') },
      { prisma: prisma as never },
    );
    const nextDay = await finalizeExpiredFamilyEnrollments(
      { contaId: 'conta-1', now: new Date('2026-09-08T03:01:00.000Z') },
      { prisma: prisma as never },
    );

    expect(lastDay.finalized).toHaveLength(0);
    expect(nextDay.finalized).toEqual(['family-last-day']);
    expect(prisma.matriculaFamiliar.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          dataFimContrato: { lt: new Date('2026-09-07T00:00:00.000Z') },
        }),
      }),
    );
    expect(prisma.matriculaFamiliar.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          dataFimContrato: { lt: new Date('2026-09-08T00:00:00.000Z') },
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
