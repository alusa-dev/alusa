import { Prisma, type PrismaClient, StatusMatricula } from '@prisma/client';

type CloseExpiredEnrollmentsResult = {
  processed: number;
  closed: Array<{
    matriculaId: string;
    previousStatus: StatusMatricula;
    newStatus: StatusMatricula;
  }>;
};

const CLOSABLE_STATUSES: readonly StatusMatricula[] = [
  StatusMatricula.ATIVA,
  StatusMatricula.PAUSADA,
] as const;

const ACTIVE_SUCCESSOR_STATUSES: readonly StatusMatricula[] = [
  StatusMatricula.PENDENTE_TAXA,
  StatusMatricula.AGUARDANDO_CONFIRMACAO,
  StatusMatricula.ATIVA,
  StatusMatricula.PAUSADA,
] as const;

function buildExpiredWithoutSuccessorWhere(input: {
  contaId: string;
  now: Date;
}): Prisma.MatriculaWhereInput {
  return {
    contaId: input.contaId,
    status: { in: [...CLOSABLE_STATUSES] },
    dataFimContrato: { lt: input.now },
    NOT: [
      {
        rematriculaItensOrigem: {
          some: {
            decision: 'RENEW',
            processo: { status: { not: 'CANCELLED' } },
          },
        },
      },
      {
        rematriculasDerivadas: {
          some: {
            status: { in: [...ACTIVE_SUCCESSOR_STATUSES] },
          },
        },
      },
    ],
  };
}

export async function closeExpiredEnrollmentsWithoutSuccessor(
  input: { contaId: string; now?: Date; limit?: number },
  deps: { prisma: PrismaClient },
): Promise<CloseExpiredEnrollmentsResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const where = buildExpiredWithoutSuccessorWhere({ contaId: input.contaId, now });

  const candidates = await deps.prisma.matricula.findMany({
    where,
    select: {
      id: true,
      status: true,
      dataFimContrato: true,
      contratoAtualId: true,
    },
    orderBy: { dataFimContrato: 'asc' },
    take: limit,
  });

  const closed: CloseExpiredEnrollmentsResult['closed'] = [];

  for (const candidate of candidates) {
    const closedItem = await deps.prisma.$transaction(async (tx) => {
      const update = await tx.matricula.updateMany({
        where: {
          id: candidate.id,
          ...buildExpiredWithoutSuccessorWhere({ contaId: input.contaId, now }),
        },
        data: {
          status: StatusMatricula.ENCERRADA,
          statusContrato: 'EXPIRADO',
        },
      });

      if (update.count === 0) return null;

      if (candidate.contratoAtualId) {
        await tx.contrato.updateMany({
          where: {
            id: candidate.contratoAtualId,
            contaId: input.contaId,
            status: { notIn: ['EXPIRADO', 'CANCELADO'] },
          },
          data: { status: 'EXPIRADO' },
        });
      }

      await tx.matriculaLog.create({
        data: {
          matriculaId: candidate.id,
          action: 'ENCERRAMENTO_NATURAL',
          metadata: {
            previousStatus: candidate.status,
            newStatus: StatusMatricula.ENCERRADA,
            dataFimContrato: candidate.dataFimContrato.toISOString(),
            closedAt: now.toISOString(),
            reason: 'CONTRACT_PERIOD_ENDED_WITHOUT_SUCCESSOR',
          } as Prisma.InputJsonValue,
        },
      });

      return {
        matriculaId: candidate.id,
        previousStatus: candidate.status,
        newStatus: StatusMatricula.ENCERRADA,
      };
    });

    if (closedItem) closed.push(closedItem);
  }

  return {
    processed: candidates.length,
    closed,
  };
}
