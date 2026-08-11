import { Prisma, type PrismaClient, StatusMatricula } from '@prisma/client';
import { prisma as appPrisma } from '@/src/prisma';

const FAMILY_TERMINAL_STATUSES: readonly StatusMatricula[] = [
  StatusMatricula.ENCERRADA,
  StatusMatricula.CANCELADA,
  StatusMatricula.RECUSADA,
] as const;

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

/**
 * Finaliza o agregado acadêmico familiar depois que os seus membros foram
 * encerrados. As relações com turma são preservadas para histórico; a vaga é
 * liberada pela regra canônica de ocupação baseada em status e período.
 *
 * A assinatura financeira é encaminhada por outbox para que o encerramento
 * remoto seja idempotente e possa ser reprocessado sem bloquear o job acadêmico.
 */
export async function finalizeExpiredFamilyEnrollments(input: {
  contaId: string;
  now?: Date;
  limit?: number;
}, deps: { prisma: PrismaClient } = { prisma: appPrisma }) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(100, input.limit ?? 100));
  const families = await deps.prisma.matriculaFamiliar.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['ATIVO', 'PARCIAL'] },
      dataFimContrato: { lt: now },
    },
    orderBy: { dataFimContrato: 'asc' },
    take: limit,
    select: {
      id: true,
      dataFimContrato: true,
      standaloneSubscriptionId: true,
      matriculas: {
        select: {
          id: true,
          status: true,
          rematriculasDerivadas: {
            where: { status: { in: ['PENDENTE_TAXA', 'AGUARDANDO_CONFIRMACAO', 'ATIVA', 'PAUSADA'] } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  const finalized: string[] = [];
  const pendingFinancialClosure: string[] = [];

  for (const family of families) {
    if (!family.matriculas.length) continue;
    if (family.matriculas.some((item) => !FAMILY_TERMINAL_STATUSES.includes(item.status))) continue;
    if (family.matriculas.some((item) => item.rematriculasDerivadas.length > 0)) continue;

    const dedupeKey = `MATRICULA_FAMILIAR:${family.id}:CLOSE_SUBSCRIPTION`;
    if (family.standaloneSubscriptionId) {
      try {
        await deps.prisma.familyBillingOutbox.create({
          data: {
            contaId: input.contaId,
            aggregateType: 'MATRICULA_FAMILIAR',
            aggregateId: family.id,
            eventType: 'CLOSE_MATRICULA_FAMILIAR_SUBSCRIPTION',
            dedupeKey,
            matriculaFamiliarId: family.id,
            payload: {
              contaId: input.contaId,
              aggregateId: family.id,
              aggregateType: 'MATRICULA_FAMILIAR',
              sourceFinancialAgreementId: family.standaloneSubscriptionId,
              effectiveDate: now.toISOString().slice(0, 10),
            },
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
      }
      pendingFinancialClosure.push(family.id);
      continue;
    }

    const updated = await deps.prisma.matriculaFamiliar.updateMany({
      where: { id: family.id, contaId: input.contaId, status: { in: ['ATIVO', 'PARCIAL'] } },
      data: { status: 'CANCELADO', academicStatus: 'COMPLETO' },
    });
    if (updated.count > 0) finalized.push(family.id);
  }

  return {
    inspected: families.length,
    finalized,
    pendingFinancialClosure,
  };
}
