import { Prisma, type PrismaClient, StatusMatricula } from '@prisma/client';
import { prisma as appPrisma } from '@/src/prisma';
import { getAcademicDateBoundsForInstant, normalizeAcademicTimeZone } from '@alusa/shared/date-only';

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
  academicDateStart: Date;
}): Prisma.MatriculaWhereInput {
  return {
    contaId: input.contaId,
    status: { in: [...CLOSABLE_STATUSES] },
    dataFimContrato: { lt: input.academicDateStart },
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

function isP2002(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002',
  );
}

function hasUniqueTarget(error: unknown, field: string): boolean {
  if (!error || typeof error !== 'object' || !('meta' in error)) return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) && target.some((value) => value === field);
}

async function resolveAcademicContext(
  input: { contaId: string; now?: Date; timeZone?: string },
  deps: { prisma: PrismaClient },
) {
  const now = input.now ?? new Date();
  const conta = input.timeZone
    ? null
    : await deps.prisma.conta?.findUnique({
        where: { id: input.contaId },
        select: { timezone: true },
      });
  const timeZone = input.timeZone ?? conta?.timezone;
  const academicDay = getAcademicDateBoundsForInstant(now, timeZone);

  return { now, academicDay };
}

export async function listContasWithExpiredEnrollments(input: {
  prisma?: PrismaClient;
  maxAccounts: number;
  now: Date;
}) {
  const db = input.prisma ?? appPrisma;
  const contas = await db.conta.findMany({
    where: { status: 'ATIVO', deletedAt: null },
    select: { id: true, timezone: true },
    orderBy: { id: 'asc' },
  });

  const contasPorTimezone = new Map<string, string[]>();
  for (const conta of contas) {
    const timeZone = normalizeAcademicTimeZone(conta.timezone);
    const contaIds = contasPorTimezone.get(timeZone) ?? [];
    contaIds.push(conta.id);
    contasPorTimezone.set(timeZone, contaIds);
  }

  const contasElegiveis = new Set<string>();
  for (const [timeZone, contaIds] of contasPorTimezone) {
    const academicDay = getAcademicDateBoundsForInstant(input.now, timeZone);
    const candidates = await db.matricula.findMany({
      where: {
        contaId: { in: contaIds },
        OR: [
          {
            status: { in: ['ATIVA', 'PAUSADA'] },
            dataFimContrato: { lt: academicDay.start },
          },
          {
            matriculaFamiliar: {
              status: { in: ['ATIVO', 'PARCIAL'] },
              dataFimContrato: { lt: academicDay.start },
            },
          },
        ],
      },
      select: { contaId: true },
      distinct: ['contaId'],
      orderBy: { contaId: 'asc' },
      take: input.maxAccounts,
    });

    for (const candidate of candidates) contasElegiveis.add(candidate.contaId);
  }

  return Array.from(contasElegiveis).sort().slice(0, input.maxAccounts);
}

export async function closeExpiredEnrollmentsWithoutSuccessor(
  input: { contaId: string; now?: Date; timeZone?: string; limit?: number },
  deps: { prisma: PrismaClient } = { prisma: appPrisma },
): Promise<CloseExpiredEnrollmentsResult> {
  const { now, academicDay } = await resolveAcademicContext(input, deps);
  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const where = buildExpiredWithoutSuccessorWhere({
    contaId: input.contaId,
    academicDateStart: academicDay.start,
  });

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
          ...buildExpiredWithoutSuccessorWhere({
            contaId: input.contaId,
            academicDateStart: academicDay.start,
          }),
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
  timeZone?: string;
  limit?: number;
}, deps: { prisma: PrismaClient } = { prisma: appPrisma }) {
  const { academicDay } = await resolveAcademicContext(input, deps);
  const limit = Math.max(1, Math.min(100, input.limit ?? 100));
  const families = await deps.prisma.matriculaFamiliar.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['ATIVO', 'PARCIAL'] },
      dataFimContrato: { lt: academicDay.start },
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
              effectiveDate: academicDay.dateKey,
            },
          },
        });
      } catch (error) {
        if (!isP2002(error) || !hasUniqueTarget(error, 'dedupeKey')) {
          throw error;
        }
        const existingOutbox = await deps.prisma.familyBillingOutbox.findFirst({
          where: { contaId: input.contaId, dedupeKey },
          select: { id: true },
        });
        if (!existingOutbox) throw error;
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
