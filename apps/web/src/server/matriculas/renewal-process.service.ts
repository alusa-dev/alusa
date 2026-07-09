import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  buildRenewalPreview,
  type RenewalItemInput,
  type RenewalOrigin,
  type RenewalHolderType,
} from '@alusa/domain';
import { AsaasHttpError, deletePayment, deleteSubscription, isAsaasEnabled } from '@alusa/finance';
import { buildSeatOccupancyWhereClause } from '@alusa/lib';
import { createRenewalPending } from './renewal-governance.service';
import { enqueueFutureFinancialProvisioning } from './renewal-outbox.service';
import {
  compareEnrollmentRecency,
  type EnrollmentChainRow,
  isClosedEnrollmentStatus,
  resolveEnrollmentRootId,
} from './rematricula-chain';
import { assertStudentCapacity } from '@/src/server/platform-billing/capacity';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type RenewalRemoteCancellationStatus = 'NOT_NEEDED' | 'CANCELLED' | 'REQUIRES_RECONCILIATION' | 'FAILED';

type RenewalRemoteCancellationIssue = {
  targetType: 'PAYMENT' | 'SUBSCRIPTION';
  externalId: string;
  code: string;
  message: string;
  uncertain: boolean;
};

type RenewalRemoteCancellationResult = {
  status: RenewalRemoteCancellationStatus;
  cancelledPaymentIds: string[];
  cancelledSubscriptionIds: string[];
  alreadyAbsentPaymentIds: string[];
  alreadyAbsentSubscriptionIds: string[];
  issues: RenewalRemoteCancellationIssue[];
};

export type RenewalFinancialTermsInput = {
  paymentMethod?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | null;
  enrollmentFeePaymentMethod?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | null;
  dueDay?: number | null;
  enrollmentFeeAmount?: number | null;
  enrollmentFeeExempt?: boolean | null;
  feeChargeMoment?: 'CHARGE_ON_CONFIRMATION' | 'CHARGE_ON_START' | 'EXEMPT';
  feeUnit?: 'NO_FEE' | 'PER_STUDENT' | 'PER_FAMILY';
  feePurpose?: 'ADMINISTRATIVE_FEE' | 'SEAT_RESERVATION' | 'ADVANCE_FIRST_TUITION';
};

export type RenewalProcessInput = {
  contaId: string;
  actorId: string;
  origin: RenewalOrigin;
  campaignId?: string | null;
  targetPeriodId: string;
  targetPeriodStartsAt?: Date | null;
  holderType: RenewalHolderType;
  holderId: string;
  items: RenewalItemInput[];
  effectiveAt?: Date | null;
  firstDueDate?: Date | null;
  targetContractEndsAt?: Date | null;
  contractModelId?: string | null;
  financialTerms?: RenewalFinancialTermsInput | null;
};

export type ConfirmRenewalProcessInput = RenewalProcessInput & {
  previewHash: string;
  sourceVersion: string;
  idempotencyKey: string;
};

export type EditRenewalFutureLinkInput = {
  contaId: string;
  processId: string;
  actorId: string;
  targetClassId?: string | null;
  targetComboId?: string | null;
  targetPlanId?: string | null;
  holderId?: string | null;
  holderType?: RenewalHolderType | null;
  effectiveAt?: Date | null;
  firstDueDate?: Date | null;
  targetContractEndsAt?: Date | null;
  contractModelId?: string | null;
  paymentMethod?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | null;
  enrollmentFeePaymentMethod?: 'BOLETO' | 'PIX' | 'CARTAO_CREDITO' | null;
  dueDay?: number | null;
  enrollmentFeeAmount?: number | null;
  enrollmentFeeExempt?: boolean | null;
  enrollmentFeeJustification?: string | null;
  feeChargeMoment?: 'CHARGE_ON_CONFIRMATION' | 'CHARGE_ON_START' | 'EXEMPT' | null;
  feeUnit?: 'NO_FEE' | 'PER_STUDENT' | 'PER_FAMILY' | null;
  feePurpose?: 'ADMINISTRATIVE_FEE' | 'SEAT_RESERVATION' | 'ADVANCE_FIRST_TUITION' | null;
  monthlyAmount?: number | null;
  lateFeePercent?: number | null;
  interestMonthlyPercent?: number | null;
  earlyDiscountPercent?: number | null;
  earlyDiscountDays?: number | null;
  reason: string;
};

type LoadedSource = Awaited<ReturnType<typeof loadSourceRows>>[number];

function toMoney(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function toDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addYears(date: Date, years: number) {
  const next = toDateOnly(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function isSameOrAfterDate(left: Date, right: Date) {
  return toDateOnly(left).getTime() >= toDateOnly(right).getTime();
}

function parsePeriodStart(targetPeriodId: string) {
  const year = targetPeriodId.match(/^(\d{4})$/)?.[1];
  if (year) return new Date(Date.UTC(Number(year), 0, 1));

  const date = new Date(targetPeriodId);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveFirstDueDate(effectiveAt: Date, dueDay?: number | null) {
  if (!dueDay) return null;
  const day = Math.min(28, Math.max(1, dueDay));
  const due = new Date(Date.UTC(effectiveAt.getUTCFullYear(), effectiveAt.getUTCMonth(), day));
  if (due <= effectiveAt) {
    return new Date(Date.UTC(effectiveAt.getUTCFullYear(), effectiveAt.getUTCMonth() + 1, day));
  }
  return due;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashDependencySnapshot(snapshot: Record<string, unknown>) {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

function mapDecisionToItemStatus(decision: RenewalItemInput['decision']) {
  if (decision === 'RENEW') return 'RENEWED';
  return decision;
}

async function loadEnrollmentChainRows(prisma: PrismaLike, contaId: string, sourceRows: LoadedSource[]) {
  const alunoIds = Array.from(new Set(sourceRows.map((source) => source.alunoId)));
  if (alunoIds.length === 0) return [];

  return prisma.matricula.findMany({
    where: {
      contaId,
      alunoId: { in: alunoIds },
    },
    select: {
      id: true,
      alunoId: true,
      rematriculadaDeId: true,
      status: true,
      dataInicio: true,
      dataFimContrato: true,
      createdAt: true,
    },
  });
}

async function loadSourceRows(prisma: PrismaLike, contaId: string, items: RenewalItemInput[]) {
  const ids = Array.from(new Set(items.map((item) => item.sourceEnrollmentId)));
  if (ids.length === 0) return [];

  return prisma.matricula.findMany({
    where: {
      contaId,
      id: { in: ids },
    },
    include: {
      aluno: { select: { id: true, nome: true, contaId: true } },
      responsavelFinanceiro: { select: { id: true, nome: true, contaId: true } },
      plano: { select: { id: true, nome: true, valor: true, periodicidade: true, contaId: true } },
      combo: { select: { id: true, nome: true, valor: true, periodicidade: true, contaId: true } },
      turma: { select: { id: true, nome: true, contaId: true } },
    },
  });
}

async function resolveTargets(prisma: PrismaLike, contaId: string, items: RenewalItemInput[]) {
  const renewItems = items.filter(
    (item): item is Extract<RenewalItemInput, { decision: 'RENEW' }> => item.decision === 'RENEW',
  );
  const planIds = Array.from(
    new Set(
      renewItems
        .filter((item) => item.target.type === 'CLASS' || item.target.planId !== item.target.targetId)
        .map((item) => item.target.planId)
        .filter(Boolean),
    ),
  );
  const classIds = Array.from(
    new Set(renewItems.filter((item) => item.target.type === 'CLASS').map((item) => item.target.targetId)),
  );
  const comboIds = Array.from(
    new Set(renewItems.filter((item) => item.target.type === 'COMBO').map((item) => item.target.targetId)),
  );

  const [plans, classes, combos] = await Promise.all([
    planIds.length
      ? prisma.plano.findMany({
          where: { contaId, id: { in: planIds }, status: 'ATIVO' },
          select: { id: true, nome: true, valor: true, periodicidade: true, updatedAt: true },
        })
      : [],
    classIds.length
      ? prisma.turma.findMany({
          where: { contaId, id: { in: classIds }, status: 'ATIVO' },
          select: { id: true, nome: true, capacidade: true, updatedAt: true },
        })
      : [],
    comboIds.length
      ? prisma.combo.findMany({
          where: { contaId, id: { in: comboIds }, status: 'ATIVO' },
          select: { id: true, nome: true, valor: true, periodicidade: true, vagasLimite: true, updatedAt: true },
        })
      : [],
  ]);

  return {
    plansById: new Map(plans.map((plan) => [plan.id, plan])),
    classesById: new Map(classes.map((turma) => [turma.id, turma])),
    combosById: new Map(combos.map((combo) => [combo.id, combo])),
  };
}

async function loadCampaignSnapshot(prisma: PrismaLike, input: RenewalProcessInput) {
  if (input.origin !== 'CAMPAIGN' && !input.campaignId) return { snapshot: null, blockers: [] };
  if (!input.campaignId) {
    return {
      snapshot: null,
      blockers: [
        {
          sourceEnrollmentId: 'process',
          code: 'CAMPAIGN_REQUIRED',
          message: 'RematrÃ­cula de campanha exige campanha vinculada.',
        },
      ],
    };
  }

  const campaign = await prisma.rematriculaCampanha.findFirst({
    where: { id: input.campaignId, contaId: input.contaId, targetPeriodId: input.targetPeriodId },
    select: { id: true, status: true, version: true, updatedAt: true },
  });

  if (!campaign) {
    return {
      snapshot: null,
      blockers: [
        {
          sourceEnrollmentId: 'process',
          code: 'CAMPAIGN_NOT_FOUND',
          message: 'Campanha nÃ£o encontrada para este perÃ­odo.',
        },
      ],
    };
  }

  if (campaign.status !== 'ACTIVE') {
    return {
      snapshot: campaign,
      blockers: [
        {
          sourceEnrollmentId: 'process',
          code: 'CAMPAIGN_NOT_ACTIVE',
          message: 'A campanha precisa estar ativa para iniciar ou confirmar rematrÃ­culas.',
        },
      ],
    };
  }

  const sourceIds = Array.from(new Set(input.items.map((item) => item.sourceEnrollmentId)));
  const participants = sourceIds.length
    ? await prisma.rematriculaParticipante.findMany({
        where: {
          contaId: input.contaId,
          campanhaId: campaign.id,
          matriculaOrigemId: { in: sourceIds },
        },
        select: { matriculaOrigemId: true, status: true, updatedAt: true },
      })
    : [];
  const participantBySource = new Map(participants.map((participant) => [participant.matriculaOrigemId, participant]));
  const blockers = sourceIds.flatMap((sourceEnrollmentId) => {
    const participant = participantBySource.get(sourceEnrollmentId);
    if (participant && participant.status === 'EXCLUDED') {
      return [
        {
          sourceEnrollmentId,
          code: 'CAMPAIGN_PARTICIPANT_EXCLUDED',
          message: 'O participante foi removido desta campanha.',
        },
      ];
    }
    return [];
  });

  return {
    snapshot: {
      id: campaign.id,
      status: campaign.status,
      version: campaign.version,
      updatedAt: campaign.updatedAt.toISOString(),
      participants: participants.map((participant) => ({
        matriculaOrigemId: participant.matriculaOrigemId,
        status: participant.status,
        updatedAt: participant.updatedAt.toISOString(),
      })),
      missingParticipants: sourceIds.filter((sourceEnrollmentId) => !participantBySource.has(sourceEnrollmentId)),
    },
    blockers,
  };
}

async function ensureCampaignParticipants(
  prisma: Prisma.TransactionClient,
  input: ConfirmRenewalProcessInput,
  sourceRows: LoadedSource[],
) {
  if (input.origin !== 'CAMPAIGN' || !input.campaignId) return [];

  const sourceIds = sourceRows.map((source) => source.id);
  const existing = sourceIds.length
    ? await prisma.rematriculaParticipante.findMany({
        where: {
          contaId: input.contaId,
          campanhaId: input.campaignId,
          matriculaOrigemId: { in: sourceIds },
        },
        select: { matriculaOrigemId: true },
      })
    : [];
  const existingIds = new Set(existing.map((participant) => participant.matriculaOrigemId));
  const includedOnDemandIds: string[] = [];

  for (const source of sourceRows) {
    if (!existingIds.has(source.id)) {
      includedOnDemandIds.push(source.id);
    }

    await prisma.rematriculaParticipante.upsert({
      where: {
        uq_rematricula_participante_campanha_origem: {
          campanhaId: input.campaignId,
          matriculaOrigemId: source.id,
        },
      },
      update: {
        status: 'ELIGIBLE',
        alunoId: source.alunoId,
        responsavelId: source.responsavelFinanceiroId,
        currentClassId: source.turmaId,
        currentContractEndsAt: source.dataFimContrato,
        eligibilityReason: 'INCLUIDO_SOB_DEMANDA',
        eligibilitySnapshot: {
          source: sourceSnapshot(source),
          aluno: source.aluno
            ? {
                id: source.aluno.id,
                nome: source.aluno.nome,
              }
            : null,
          responsavel: source.responsavelFinanceiro
            ? {
                id: source.responsavelFinanceiro.id,
                nome: source.responsavelFinanceiro.nome,
              }
            : null,
          turma: source.turma
            ? {
                id: source.turma.id,
                nome: source.turma.nome,
              }
            : null,
          plano: source.plano
            ? {
                id: source.plano.id,
                nome: source.plano.nome,
              }
            : null,
          combo: source.combo
            ? {
                id: source.combo.id,
                nome: source.combo.nome,
              }
            : null,
        } as Prisma.InputJsonValue,
        excludedAt: null,
        exclusionReason: null,
      },
      create: {
        contaId: input.contaId,
        campanhaId: input.campaignId,
        matriculaOrigemId: source.id,
        alunoId: source.alunoId,
        responsavelId: source.responsavelFinanceiroId,
        currentClassId: source.turmaId,
        currentContractEndsAt: source.dataFimContrato,
        eligibilityReason: 'INCLUIDO_SOB_DEMANDA',
        status: 'ELIGIBLE',
        includedById: input.actorId,
        eligibilitySnapshot: {
          source: sourceSnapshot(source),
          aluno: source.aluno
            ? {
                id: source.aluno.id,
                nome: source.aluno.nome,
              }
            : null,
          responsavel: source.responsavelFinanceiro
            ? {
                id: source.responsavelFinanceiro.id,
                nome: source.responsavelFinanceiro.nome,
              }
            : null,
          turma: source.turma
            ? {
                id: source.turma.id,
                nome: source.turma.nome,
              }
            : null,
          plano: source.plano
            ? {
                id: source.plano.id,
                nome: source.plano.nome,
              }
            : null,
          combo: source.combo
            ? {
                id: source.combo.id,
                nome: source.combo.nome,
              }
            : null,
        } as Prisma.InputJsonValue,
      },
    });
  }

  return includedOnDemandIds;
}

async function findDuplicateRenewalItems(
  prisma: PrismaLike,
  input: RenewalProcessInput,
  sourceRows: LoadedSource[],
  excludeProcessId?: string | null,
) {
  const sourceIds = Array.from(new Set(input.items.map((item) => item.sourceEnrollmentId)));
  if (sourceIds.length === 0) return [];

  const chainRows = await loadEnrollmentChainRows(prisma, input.contaId, sourceRows);
  const chainById = new Map<string, EnrollmentChainRow>(chainRows.map((row) => [row.id, row]));
  const chainIds = chainRows.length ? chainRows.map((row) => row.id) : sourceIds;

  const duplicates = await prisma.rematriculaItem.findMany({
    where: {
      contaId: input.contaId,
      targetPeriodId: input.targetPeriodId,
      OR: [{ matriculaOrigemId: { in: chainIds } }, { matriculaFuturaId: { in: chainIds } }],
      processo: {
        status: { notIn: ['CANCELLED'] },
        ...(excludeProcessId ? { id: { not: excludeProcessId } } : {}),
      },
    },
    select: { matriculaOrigemId: true, matriculaFuturaId: true, processoId: true },
  });

  if (!chainRows.length) {
    return duplicates.map((item) => ({
      sourceEnrollmentId: item.matriculaOrigemId,
      code: 'DUPLICATE_SOURCE_TARGET_PERIOD',
      message: 'JÃ¡ existe rematrÃ­cula ativa para este vÃ­nculo e perÃ­odo de destino.',
    }));
  }

  const duplicateRootIds = new Set<string>();
  for (const item of duplicates) {
    const originRootId = resolveEnrollmentRootId(item.matriculaOrigemId, chainById);
    if (chainById.has(originRootId)) duplicateRootIds.add(originRootId);

    if (item.matriculaFuturaId) {
      const futureRootId = resolveEnrollmentRootId(item.matriculaFuturaId, chainById);
      if (chainById.has(futureRootId)) duplicateRootIds.add(futureRootId);
    }
  }

  return sourceRows.filter((source) => duplicateRootIds.has(resolveEnrollmentRootId(source.id, chainById))).map((source) => ({
    sourceEnrollmentId: source.id,
    code: 'DUPLICATE_SOURCE_TARGET_PERIOD',
    message: 'JÃ¡ existe rematrÃ­cula ativa para este vÃ­nculo e perÃ­odo de destino.',
  }));
}

async function findOutdatedSourceEnrollments(
  prisma: PrismaLike,
  contaId: string,
  sourceRows: LoadedSource[],
) {
  const chainRows = await loadEnrollmentChainRows(prisma, contaId, sourceRows);
  if (chainRows.length === 0) return [];

  const chainById = new Map<string, EnrollmentChainRow>(chainRows.map((row) => [row.id, row]));
  const latestByRootId = new Map<string, EnrollmentChainRow>();

  for (const row of chainRows) {
    if (isClosedEnrollmentStatus(row.status)) continue;

    const rootId = resolveEnrollmentRootId(row.id, chainById);
    const current = latestByRootId.get(rootId);
    if (!current || compareEnrollmentRecency(row, current) > 0) {
      latestByRootId.set(rootId, row);
    }
  }

  return sourceRows.flatMap((source) => {
    const rootId = resolveEnrollmentRootId(source.id, chainById);
    const latest = latestByRootId.get(rootId);
    if (!latest || latest.id === source.id) return [];

    return [
      {
        sourceEnrollmentId: source.id,
        code: 'OUTDATED_SOURCE_ENROLLMENT',
        message: 'Esta matrÃ­cula jÃ¡ possui uma rematrÃ­cula posterior. Use o vÃ­nculo mais recente como origem.',
      },
    ];
  });
}

async function validateRenewalCapacity(
  prisma: PrismaLike,
  input: RenewalProcessInput,
  effectiveAt: Date,
  targets: Awaited<ReturnType<typeof resolveTargets>>,
) {
  const renewItems = input.items.filter(
    (item): item is Extract<RenewalItemInput, { decision: 'RENEW' }> => item.decision === 'RENEW',
  );
  const blockers: Array<{ sourceEnrollmentId: string; code: string; message: string }> = [];
  const sourceIds = Array.from(new Set(renewItems.map((item) => item.sourceEnrollmentId)));

  const classGroups = new Map<string, Array<Extract<RenewalItemInput, { decision: 'RENEW' }>>>();
  const comboGroups = new Map<string, Array<Extract<RenewalItemInput, { decision: 'RENEW' }>>>();
  for (const item of renewItems) {
    if (item.target.type === 'CLASS') {
      classGroups.set(item.target.targetId, [...(classGroups.get(item.target.targetId) ?? []), item]);
    } else {
      comboGroups.set(item.target.targetId, [...(comboGroups.get(item.target.targetId) ?? []), item]);
    }
  }

  for (const [classId, items] of classGroups.entries()) {
    const targetClass = targets.classesById.get(classId);
    if (!targetClass) continue;

    const [currentOccupancy, reservedOccupancy] = await Promise.all([
      prisma.matricula.count({
        where: {
          contaId: input.contaId,
          turmaId: classId,
          dataFimContrato: { gte: effectiveAt },
          ...buildSeatOccupancyWhereClause(effectiveAt),
          id: { notIn: sourceIds },
        },
      }),
      prisma.reservaVagaFutura.count({
        where: {
          contaId: input.contaId,
          targetClassId: classId,
          targetPeriodId: input.targetPeriodId,
          status: { in: ['RESERVED', 'WAITLISTED'] },
          matriculaOrigemId: { notIn: sourceIds },
        },
      }),
    ]);

    if (currentOccupancy + reservedOccupancy + items.length > targetClass.capacidade) {
      blockers.push(
        ...items.map((item) => ({
          sourceEnrollmentId: item.sourceEnrollmentId,
          code: 'TARGET_CLASS_FULL',
          message: `Turma futura "${targetClass.nome}" nÃ£o possui vagas disponÃ­veis.`,
        })),
      );
    }
  }

  for (const [comboId, items] of comboGroups.entries()) {
    const targetCombo = targets.combosById.get(comboId);
    if (!targetCombo?.vagasLimite) continue;

    const [currentOccupancy, reservedOccupancy] = await Promise.all([
      prisma.matricula.count({
        where: {
          contaId: input.contaId,
          comboId,
          dataFimContrato: { gte: effectiveAt },
          ...buildSeatOccupancyWhereClause(effectiveAt),
          id: { notIn: sourceIds },
        },
      }),
      prisma.rematriculaItem.count({
        where: {
          contaId: input.contaId,
          targetPeriodId: input.targetPeriodId,
          targetComboId: comboId,
          decision: 'RENEW',
          matriculaOrigemId: { notIn: sourceIds },
          processo: { status: { notIn: ['CANCELLED'] } },
        },
      }),
    ]);

    if (currentOccupancy + reservedOccupancy + items.length > targetCombo.vagasLimite) {
      blockers.push(
        ...items.map((item) => ({
          sourceEnrollmentId: item.sourceEnrollmentId,
          code: 'TARGET_COMBO_FULL',
          message: `Combo futuro "${targetCombo.nome}" nÃ£o possui vagas disponÃ­veis.`,
        })),
      );
    }
  }

  return blockers;
}

function sourceSnapshot(source: LoadedSource) {
  return {
    id: source.id,
    alunoId: source.alunoId,
    responsavelFinanceiroId: source.responsavelFinanceiroId,
    turmaId: source.turmaId,
    planoId: source.planoId,
    comboId: source.comboId,
    dataInicio: source.dataInicio.toISOString(),
    dataFimContrato: source.dataFimContrato.toISOString(),
    status: source.status,
    statusContrato: source.statusContrato,
    statusFinanceiro: source.statusFinanceiro,
    updatedAt: source.updatedAt.toISOString(),
  };
}

function externalReferenceForProcess(contaId: string, idempotencyKey: string) {
  return `renewal:${contaId}:${idempotencyKey}`;
}

export async function previewRenewalProcess(input: RenewalProcessInput, deps: { prisma: PrismaLike }) {
  const sourceRows = await loadSourceRows(deps.prisma, input.contaId, input.items);
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const targets = await resolveTargets(deps.prisma, input.contaId, input.items);
  const campaign = await loadCampaignSnapshot(deps.prisma, input);
  const duplicateBlockers = await findDuplicateRenewalItems(deps.prisma, input, sourceRows);
  const outdatedSourceBlockers = await findOutdatedSourceEnrollments(deps.prisma, input.contaId, sourceRows);
  const externalBlockers: Array<{ sourceEnrollmentId: string; code: string; message: string }> = [];

  const dependencySnapshot = {
    campaign: campaign.snapshot,
    targets: {
      plans: Array.from(targets.plansById.values()).map((plan) => ({
        id: plan.id,
        updatedAt: plan.updatedAt.toISOString(),
        valor: toMoney(plan.valor),
        periodicidade: plan.periodicidade,
      })),
      classes: Array.from(targets.classesById.values()).map((turma) => ({
        id: turma.id,
        updatedAt: turma.updatedAt.toISOString(),
        capacidade: turma.capacidade,
      })),
      combos: Array.from(targets.combosById.values()).map((combo) => ({
        id: combo.id,
        updatedAt: combo.updatedAt.toISOString(),
        valor: toMoney(combo.valor),
        periodicidade: combo.periodicidade,
        vagasLimite: combo.vagasLimite,
      })),
    },
  };

  const sourceEnrollments = input.items
    .map((item) => {
      const source = sourceById.get(item.sourceEnrollmentId);
      if (!source) return null;

      let monthlyAmount = toMoney(source.combo?.valor ?? source.plano?.valor);
      if (item.decision === 'RENEW') {
        const targetPlan = targets.plansById.get(item.target.planId);
        if (item.target.type === 'CLASS' && !targetPlan) {
          externalBlockers.push({
            sourceEnrollmentId: item.sourceEnrollmentId,
            code: 'TARGET_PLAN_NOT_FOUND',
            message: 'Plano futuro nÃ£o encontrado na conta atual.',
          });
        }

        if (item.target.type === 'CLASS') {
          if (!targets.classesById.has(item.target.targetId)) {
            externalBlockers.push({
              sourceEnrollmentId: item.sourceEnrollmentId,
              code: 'TARGET_CLASS_NOT_FOUND',
              message: 'Turma futura nÃ£o encontrada na conta atual.',
            });
          }
          monthlyAmount = toMoney(targetPlan?.valor);
        } else {
          const targetCombo = targets.combosById.get(item.target.targetId);
          if (!targetCombo) {
            externalBlockers.push({
              sourceEnrollmentId: item.sourceEnrollmentId,
              code: 'TARGET_COMBO_NOT_FOUND',
              message: 'Combo futuro nÃ£o encontrado na conta atual.',
            });
          }
          monthlyAmount = toMoney(targetCombo?.valor ?? targetPlan?.valor);
        }
      }

      return {
        id: source.id,
        currentContractEndsAt: source.dataFimContrato,
        updatedAt: source.updatedAt,
        monthlyAmount,
        enrollmentFeeAmount: toMoney(source.taxaMatricula),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const preview = buildRenewalPreview({
    contaId: input.contaId,
    origin: input.origin,
    campaignId: input.campaignId,
    targetPeriodId: input.targetPeriodId,
    targetPeriodStartsAt: input.targetPeriodStartsAt ?? parsePeriodStart(input.targetPeriodId),
    holderType: input.holderType,
    holderId: input.holderId,
    items: input.items,
    sourceEnrollments,
    requestedEffectiveAt: input.effectiveAt,
    requestedFirstDueDate:
      input.firstDueDate ??
      resolveFirstDueDate(
        input.effectiveAt ?? new Date(),
        input.financialTerms?.dueDay ?? sourceRows[0]?.vencimentoDia,
      ),
    dependencySnapshot,
    dependencyVersion: hashDependencySnapshot(dependencySnapshot),
    enrollmentFeeAmount:
      input.financialTerms?.enrollmentFeeExempt === true
        ? 0
        : input.financialTerms?.enrollmentFeeAmount ?? toMoney(sourceRows[0]?.taxaMatricula),
  });

  const effectiveAt = new Date(`${preview.effectiveAt}T00:00:00.000Z`);
  const capacityBlockers =
    preview.blockers.length || externalBlockers.length
      ? []
      : await validateRenewalCapacity(deps.prisma, input, effectiveAt, targets);

  return {
    ...preview,
    blockers: [
      ...preview.blockers,
      ...externalBlockers,
      ...campaign.blockers,
      ...outdatedSourceBlockers,
      ...duplicateBlockers,
      ...capacityBlockers,
    ],
  };
}

export async function confirmRenewalProcess(
  input: ConfirmRenewalProcessInput,
  deps: { prisma: PrismaClient },
) {
  let idempotencyKey = input.idempotencyKey;
  const existing = await deps.prisma.rematriculaProcesso.findFirst({
    where: { contaId: input.contaId, idempotencyKey },
    include: { itens: true },
  });
  if (existing && existing.status !== 'CANCELLED') {
    return {
      processId: existing.id,
      status: existing.status,
      previewHash: existing.previewHash,
      renewCount: existing.renewCount,
      pendingCount: existing.pendingCount,
      nonRenewalCount: existing.nonRenewalCount,
      idempotent: true,
    };
  }
  if (existing?.status === 'CANCELLED') {
    idempotencyKey = `${input.idempotencyKey}:after-cancel:${Date.now()}`;
  }

  return deps.prisma.$transaction(async (tx) => {
    const preview = await previewRenewalProcess(input, { prisma: tx });
    if (preview.previewHash !== input.previewHash || preview.sourceVersion !== input.sourceVersion) {
      throw new Error('PREVIEW_DESATUALIZADO');
    }
    if (preview.blockers.length > 0) {
      throw new Error(preview.blockers[0]?.message ?? 'Preview possui bloqueios.');
    }

    const sourceRows = await loadSourceRows(tx, input.contaId, input.items);
    const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
    const targets = await resolveTargets(tx, input.contaId, input.items);
    const effectiveAt = new Date(`${preview.effectiveAt}T00:00:00.000Z`);
    const firstDueDate = preview.firstDueDate ? new Date(`${preview.firstDueDate}T00:00:00.000Z`) : null;
    const targetContractEndsAt = input.targetContractEndsAt ?? addYears(effectiveAt, 1);
    const processStatus =
      preview.renewCount > 0
        ? effectiveAt > new Date()
          ? 'WAITING_FOR_START'
          : 'CONFIRMED'
        : 'COMPLETED';
    const externalReference = externalReferenceForProcess(input.contaId, idempotencyKey);

    const includedOnDemandIds = await ensureCampaignParticipants(tx, input, sourceRows);

    const processo = await tx.rematriculaProcesso.create({
      data: {
        contaId: input.contaId,
        campanhaId: input.campaignId ?? null,
        origin: input.origin,
        targetPeriodId: input.targetPeriodId,
        holderType: input.holderType,
        holderId: input.holderId,
        status: processStatus,
        sourceVersion: preview.sourceVersion,
        previewHash: preview.previewHash,
        previewSnapshot: preview.snapshot as Prisma.InputJsonValue,
        currentContractEndsAt: sourceRows.length
          ? new Date(Math.max(...sourceRows.map((source) => source.dataFimContrato.getTime())))
          : null,
        effectiveAt,
        firstDueDate,
        confirmedAt: new Date(),
        idempotencyKey,
        externalReference,
        renewCount: preview.renewCount,
        pendingCount: preview.pendingCount,
        nonRenewalCount: preview.nonRenewalCount,
        monthlyTotal: preview.monthlyTotal,
        enrollmentFeeTotal: preview.enrollmentFeeTotal,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });

    for (const item of input.items) {
      const source = sourceById.get(item.sourceEnrollmentId);
      if (!source) continue;

      let futureEnrollmentId: string | null = null;
      let targetClassId: string | null = null;
      let targetComboId: string | null = null;
      let targetPlanId: string | null = null;
      let targetSnapshot: Record<string, unknown> | null = null;

      if (item.decision === 'RENEW') {
        const targetPlan = targets.plansById.get(item.target.planId);
        const targetCombo =
          item.target.type === 'COMBO' ? targets.combosById.get(item.target.targetId) : null;
        const targetClass =
          item.target.type === 'CLASS' ? targets.classesById.get(item.target.targetId) : null;
        targetClassId = item.target.type === 'CLASS' ? item.target.targetId : null;
        targetComboId = item.target.type === 'COMBO' ? item.target.targetId : null;
        targetPlanId = targetPlan?.id ?? (item.target.type === 'CLASS' ? item.target.planId : null);
        targetSnapshot = {
          type: item.target.type,
          targetId: item.target.targetId,
          planId: item.target.planId,
          planName: targetPlan?.nome ?? null,
          className: targetClass?.nome ?? null,
          comboName: targetCombo?.nome ?? null,
        };

        const future = await tx.matricula.create({
          data: {
            contaId: input.contaId,
            alunoId: source.alunoId,
            responsavelFinanceiroId: source.responsavelFinanceiroId,
            turmaId: targetClassId,
            comboId: targetComboId,
            planoId: targetPlanId,
            rematriculadaDeId: source.id,
            dataInicio: effectiveAt,
            dataFimContrato: targetContractEndsAt,
            status: 'AGUARDANDO_CONFIRMACAO',
            statusFinanceiro: 'PENDENTE_FINANCEIRO',
            statusContrato: input.contractModelId ? 'AGUARDANDO_ASSINATURA' : source.statusContrato,
            taxaMatricula:
              input.financialTerms?.enrollmentFeeExempt === true
                ? 0
                : input.financialTerms?.enrollmentFeeAmount ?? source.taxaMatricula,
            taxaIsenta: input.financialTerms?.enrollmentFeeExempt ?? source.taxaIsenta,
            taxaStatus:
              input.financialTerms?.enrollmentFeeExempt === true || preview.enrollmentFeeTotal <= 0
                ? 'ISENTO'
                : 'PENDENTE',
            taxaJustificativa: source.taxaJustificativa,
            formaPagamento: input.financialTerms?.paymentMethod ?? source.formaPagamento,
            formaPagamentoTaxa:
              input.financialTerms?.enrollmentFeePaymentMethod ??
              input.financialTerms?.paymentMethod ??
              source.formaPagamentoTaxa,
            vencimentoDia: input.financialTerms?.dueDay ?? source.vencimentoDia,
            jurosMensal: source.jurosMensal,
            multaPercentual: source.multaPercentual,
            descontoAntecipado: source.descontoAntecipado,
            prazoDesconto: source.prazoDesconto,
            billingMode: source.billingMode,
          },
          select: { id: true },
        });
        futureEnrollmentId = future.id;
      }

      const createdItem = await tx.rematriculaItem.create({
        data: {
          contaId: input.contaId,
          processoId: processo.id,
          matriculaOrigemId: source.id,
          matriculaFuturaId: futureEnrollmentId,
          targetPeriodId: input.targetPeriodId,
          decision: item.decision,
          status: mapDecisionToItemStatus(item.decision),
          futureEnrollmentStatus: item.decision === 'RENEW' ? 'SCHEDULED' : null,
          targetType: item.decision === 'RENEW' ? item.target.type : null,
          targetClassId,
          targetComboId,
          targetPlanId,
          effectiveAt: item.decision === 'RENEW' ? effectiveAt : null,
          sourceSnapshot: sourceSnapshot(source) as Prisma.InputJsonValue,
          targetSnapshot: targetSnapshot as Prisma.InputJsonValue,
        },
      });

      if (item.decision === 'RENEW' && futureEnrollmentId) {
        await tx.reservaVagaFutura.create({
          data: {
            contaId: input.contaId,
            processoId: processo.id,
            itemId: createdItem.id,
            alunoId: source.alunoId,
            matriculaOrigemId: source.id,
            matriculaFuturaId: futureEnrollmentId,
            targetClassId,
            targetPeriodId: input.targetPeriodId,
            effectiveAt,
            origin: input.origin,
            status: 'RESERVED',
            confirmedAt: new Date(),
          },
        });

        if (input.contractModelId) {
          await tx.contratoFuturo.create({
            data: {
              contaId: input.contaId,
              processoId: processo.id,
              itemId: createdItem.id,
              matriculaFuturaId: futureEnrollmentId,
              contractModelId: input.contractModelId,
              status: 'WAITING_SIGNATURE',
              validFrom: effectiveAt,
              validUntil: targetContractEndsAt,
              snapshot: {
                contractModelId: input.contractModelId,
                sourceEnrollmentId: source.id,
                futureEnrollmentId,
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
    }

    if (preview.renewCount > 0) {
      const feeChargeMoment = input.financialTerms?.feeChargeMoment ?? 'CHARGE_ON_START';
      const financeiro = await tx.acordoFinanceiroFuturo.create({
        data: {
          contaId: input.contaId,
          processoId: processo.id,
          responsavelId: input.holderType === 'RESPONSIBLE' ? input.holderId : null,
          status: 'SCHEDULED',
          monthlyTotal: preview.monthlyTotal,
          enrollmentFeeTotal: preview.enrollmentFeeTotal,
          firstDueDate,
          effectiveAt,
          provisionAt: new Date(effectiveAt.getTime() - 10 * 24 * 60 * 60 * 1000),
          externalReference,
          feeChargeMoment,
          feeUnit: input.financialTerms?.feeUnit ?? (preview.enrollmentFeeTotal > 0 ? 'PER_STUDENT' : 'NO_FEE'),
          feePurpose: input.financialTerms?.feePurpose ?? 'ADMINISTRATIVE_FEE',
          snapshot: preview.futureFinancialAgreement as Prisma.InputJsonValue,
        },
      });

      if (feeChargeMoment === 'CHARGE_ON_CONFIRMATION' && preview.enrollmentFeeTotal > 0) {
        await tx.rematriculaOutbox.create({
          data: {
            contaId: input.contaId,
            processoId: processo.id,
            eventType: 'CREATE_RENEWAL_FEE_CHARGE',
            dedupeKey: `renewal-fee:${financeiro.id}`,
            payload: {
              acordoFinanceiroFuturoId: financeiro.id,
              processoId: processo.id,
              amount: preview.enrollmentFeeTotal,
              externalReference: `${externalReference}:fee`,
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    await tx.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        processoId: processo.id,
        actorId: input.actorId,
        action: preview.renewCount > 0 ? 'RENEWAL_CONFIRMED' : 'RENEWAL_DECISIONS_SAVED',
        afterState: preview.snapshot as Prisma.InputJsonValue,
        metadata: {
          idempotencyKey: input.idempotencyKey,
          previewHash: preview.previewHash,
          includedOnDemandEnrollmentIds: includedOnDemandIds,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      processId: processo.id,
      status: processo.status,
      previewHash: preview.previewHash,
      renewCount: preview.renewCount,
      pendingCount: preview.pendingCount,
      nonRenewalCount: preview.nonRenewalCount,
      idempotent: false,
    };
  });
}

export async function cancelRenewalProcess(
  input: { contaId: string; processId: string; actorId: string; reason?: string | null },
  deps: { prisma: PrismaClient },
) {
  const remoteCancellation = await cancelFutureFinancialRemoteEffects(input, deps);

  return deps.prisma.$transaction(async (tx) => {
    const processo = await tx.rematriculaProcesso.findFirst({
      where: { id: input.processId, contaId: input.contaId },
      include: { itens: true, financeiros: true },
    });
    if (!processo) throw new Error('REMATRICULA_NAO_ENCONTRADA');
    if (['CANCELLED', 'EFFECTIVE', 'COMPLETED'].includes(processo.status)) {
      throw new Error('REMATRICULA_NAO_CANCELAVEL');
    }

    const futureIds = processo.itens
      .map((item) => item.matriculaFuturaId)
      .filter((id): id is string => Boolean(id));

    if (futureIds.length > 0) {
      await tx.matricula.updateMany({
        where: { contaId: input.contaId, id: { in: futureIds } },
        data: { status: 'CANCELADA', statusFinanceiro: 'SUSPENSO', billingProvisionStatus: 'CANCELADO' },
      });
    }
    await tx.rematriculaItem.updateMany({
      where: { contaId: input.contaId, processoId: processo.id },
      data: { status: 'CANCELLED', futureEnrollmentStatus: 'CANCELLED' },
    });

    await tx.reservaVagaFutura.updateMany({
      where: { contaId: input.contaId, processoId: processo.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await tx.contratoFuturo.updateMany({
      where: { contaId: input.contaId, processoId: processo.id },
      data: { status: 'CANCELLED' },
    });
    await tx.acordoFinanceiroFuturo.updateMany({
      where: { contaId: input.contaId, processoId: processo.id },
      data: { status: 'CANCELLED' },
    });

    const provisionedFinancial = processo.financeiros.filter(
      (financeiro) => financeiro.asaasPaymentId || financeiro.asaasSubscriptionId,
    );
    if (remoteCancellation.status === 'REQUIRES_RECONCILIATION' || remoteCancellation.status === 'FAILED') {
      const uncertain = remoteCancellation.status === 'REQUIRES_RECONCILIATION';
      await createRenewalPending(
        {
          contaId: input.contaId,
          processoId: processo.id,
          type: 'MANUAL_REVIEW',
          severity: 'BLOCKER',
          code: uncertain
            ? 'FUTURE_FINANCE_REMOTE_CANCEL_RECONCILIATION_REQUIRED'
            : 'FUTURE_FINANCE_REMOTE_CANCEL_FAILED',
          title: uncertain
            ? 'Conferencia financeira do cancelamento'
            : 'Cancelamento financeiro remoto com erro',
          message: uncertain
            ? 'O proximo ciclo foi cancelado localmente, mas a resposta do financeiro ficou incerta. Confira o Asaas antes de tentar novamente.'
            : 'O proximo ciclo foi cancelado localmente, mas o financeiro remoto nao confirmou o cancelamento automatico.',
          rule: 'cancelamento_financeiro_futuro',
          impact:
            'O vinculo atual foi preservado; a equipe financeira deve conferir os efeitos futuros provisionados.',
          metadata: {
            financialAgreementIds: provisionedFinancial.map((financeiro) => financeiro.id),
            asaasPaymentIds: provisionedFinancial.map((financeiro) => financeiro.asaasPaymentId).filter(Boolean),
            asaasSubscriptionIds: provisionedFinancial
              .map((financeiro) => financeiro.asaasSubscriptionId)
              .filter(Boolean),
            remoteCancellation,
          },
          createdById: input.actorId,
        },
        { prisma: tx },
      );
    }

    await tx.rematriculaProcesso.update({
      where: { id: processo.id },
      data: { status: 'CANCELLED', updatedById: input.actorId },
    });
    await tx.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        processoId: processo.id,
        actorId: input.actorId,
        action: 'RENEWAL_CANCELLED',
        reason: input.reason ?? null,
        metadata: {
          remoteCancellation,
        } as Prisma.InputJsonValue,
      },
    });

    return { processId: processo.id, status: 'CANCELLED' as const, remoteCancellation };
  });
}

async function cancelFutureFinancialRemoteEffects(
  input: { contaId: string; processId: string },
  deps: { prisma: PrismaClient },
): Promise<RenewalRemoteCancellationResult> {
  const processo = await deps.prisma.rematriculaProcesso.findFirst({
    where: { id: input.processId, contaId: input.contaId },
    include: { financeiros: true },
  });
  if (!processo) throw new Error('REMATRICULA_NAO_ENCONTRADA');
  if (['CANCELLED', 'EFFECTIVE', 'COMPLETED'].includes(processo.status)) {
    throw new Error('REMATRICULA_NAO_CANCELAVEL');
  }

  const paymentIds = uniqueStrings(processo.financeiros.map((financeiro) => financeiro.asaasPaymentId));
  const subscriptionIds = uniqueStrings(processo.financeiros.map((financeiro) => financeiro.asaasSubscriptionId));
  const result: RenewalRemoteCancellationResult = {
    status: 'NOT_NEEDED',
    cancelledPaymentIds: [],
    cancelledSubscriptionIds: [],
    alreadyAbsentPaymentIds: [],
    alreadyAbsentSubscriptionIds: [],
    issues: [],
  };

  if (paymentIds.length === 0 && subscriptionIds.length === 0) {
    return result;
  }

  if (!isAsaasEnabled()) {
    return {
      ...result,
      status: 'REQUIRES_RECONCILIATION',
      issues: [
        ...paymentIds.map((externalId) => ({
          targetType: 'PAYMENT' as const,
          externalId,
          code: 'ASAAS_DISABLED',
          message: 'Integracao Asaas desativada; cancelamento remoto nao executado.',
          uncertain: true,
        })),
        ...subscriptionIds.map((externalId) => ({
          targetType: 'SUBSCRIPTION' as const,
          externalId,
          code: 'ASAAS_DISABLED',
          message: 'Integracao Asaas desativada; cancelamento remoto nao executado.',
          uncertain: true,
        })),
      ],
    };
  }

  for (const paymentId of paymentIds) {
    try {
      await deletePayment(paymentId, { contaId: input.contaId });
      result.cancelledPaymentIds.push(paymentId);
    } catch (error) {
      const issue = buildRemoteCancellationIssue('PAYMENT', paymentId, error);
      if (issue.code === 'REMOTE_NOT_FOUND') {
        result.alreadyAbsentPaymentIds.push(paymentId);
      } else {
        result.issues.push(issue);
      }
    }
  }

  for (const subscriptionId of subscriptionIds) {
    try {
      await deleteSubscription(subscriptionId, { contaId: input.contaId });
      result.cancelledSubscriptionIds.push(subscriptionId);
    } catch (error) {
      const issue = buildRemoteCancellationIssue('SUBSCRIPTION', subscriptionId, error);
      if (issue.code === 'REMOTE_NOT_FOUND') {
        result.alreadyAbsentSubscriptionIds.push(subscriptionId);
      } else {
        result.issues.push(issue);
      }
    }
  }

  if (result.issues.some((issue) => issue.uncertain)) {
    result.status = 'REQUIRES_RECONCILIATION';
  } else if (result.issues.length > 0) {
    result.status = 'FAILED';
  } else {
    result.status = 'CANCELLED';
  }

  return result;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function buildRemoteCancellationIssue(
  targetType: 'PAYMENT' | 'SUBSCRIPTION',
  externalId: string,
  error: unknown,
): RenewalRemoteCancellationIssue {
  if (error instanceof AsaasHttpError) {
    if (error.status === 404 || error.status === 410) {
      return {
        targetType,
        externalId,
        code: 'REMOTE_NOT_FOUND',
        message: 'Registro financeiro nao encontrado no Asaas; tratado como ja cancelado/removido.',
        uncertain: false,
      };
    }

    return {
      targetType,
      externalId,
      code: `ASAAS_HTTP_${error.status}`,
      message: extractRemoteCancellationMessage(error),
      uncertain: error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500,
    };
  }

  return {
    targetType,
    externalId,
    code: 'REMOTE_CANCEL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    uncertain: true,
  };
}

function extractRemoteCancellationMessage(error: AsaasHttpError): string {
  const responseBody = error.responseBody;
  if (responseBody && typeof responseBody === 'object') {
    const message = 'message' in responseBody && typeof responseBody.message === 'string'
      ? responseBody.message
      : null;
    if (message) return message;

    const errors = 'errors' in responseBody && Array.isArray(responseBody.errors) ? responseBody.errors : [];
    const descriptions = errors
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        return 'description' in item && typeof item.description === 'string'
          ? item.description
          : 'message' in item && typeof item.message === 'string'
            ? item.message
            : null;
      })
      .filter((value): value is string => Boolean(value));
    if (descriptions.length > 0) return descriptions.join(', ');
  }

  return error.message;
}

export async function activateDueRenewalProcesses(
  input: { contaId: string; now?: Date; limit?: number },
  deps: { prisma: PrismaClient },
) {
  const now = input.now ?? new Date();
  const processos = await deps.prisma.rematriculaProcesso.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['CONFIRMED', 'WAITING_FOR_START'] },
      effectiveAt: { lte: now },
    },
    take: input.limit ?? 25,
    orderBy: { effectiveAt: 'asc' },
    select: { id: true },
  });

  const results: Array<{ processId: string; status: 'EFFECTIVE' | 'REQUIRES_ATTENTION' }> = [];
  for (const processo of processos) {
    const result = await deps.prisma.$transaction(async (tx) => {
      const full = await tx.rematriculaProcesso.findFirst({
        where: { id: processo.id, contaId: input.contaId },
        include: { itens: true, reservas: true, financeiros: true },
      });
      if (!full) return { processId: processo.id, status: 'REQUIRES_ATTENTION' as const };

      const sourceIds = full.itens.map((item) => item.matriculaOrigemId);
      const sources = await tx.matricula.findMany({
        where: { contaId: input.contaId, id: { in: sourceIds } },
        select: { id: true, dataFimContrato: true, status: true },
      });
      const hasOverlap = sources.some((source) => source.dataFimContrato >= full.effectiveAt);
      const futureIds = full.itens
        .map((item) => item.matriculaFuturaId)
        .filter((id): id is string => Boolean(id));
      const hasMissingReservation = full.itens.some(
        (item) =>
          item.decision === 'RENEW' &&
          !full.reservas.some((reserva) => reserva.itemId === item.id && reserva.status === 'RESERVED'),
      );
      const hasMissingFinancialAgreement = full.itens.some((item) => item.decision === 'RENEW') && full.financeiros.length === 0;
      const failedFinancialAgreement = full.financeiros.find((financeiro) => financeiro.status === 'FAILED');

      if (hasOverlap || hasMissingReservation || hasMissingFinancialAgreement || failedFinancialAgreement) {
        await tx.rematriculaProcesso.update({
          where: { id: full.id },
          data: { status: 'REQUIRES_ATTENTION' },
        });
        await createRenewalPending(
          {
            contaId: input.contaId,
            processoId: full.id,
            type: 'ACTIVATION_BLOCKED',
            severity: 'BLOCKER',
            code: 'FUTURE_CYCLE_ACTIVATION_BLOCKED',
            title: 'AtivaÃ§Ã£o do prÃ³ximo ciclo bloqueada',
            message:
              'O job de ativaÃ§Ã£o encontrou sobreposiÃ§Ã£o de contrato atual, reserva futura ausente ou financeiro futuro inconsistente.',
            rule: 'activate_future_cycle',
            impact:
              'A matrÃ­cula futura nÃ£o foi ativada e nenhuma correÃ§Ã£o automÃ¡tica de turma/contrato foi aplicada.',
            metadata: {
              hasOverlap,
              hasMissingReservation,
              hasMissingFinancialAgreement,
              failedFinancialAgreementId: failedFinancialAgreement?.id ?? null,
              failedFinancialAgreementCode: failedFinancialAgreement?.failureCode ?? null,
            },
          },
          { prisma: tx },
        );
        await tx.rematriculaAuditLog.create({
          data: {
            contaId: input.contaId,
            processoId: full.id,
            action: 'FUTURE_CYCLE_ACTIVATION_BLOCKED',
            metadata: {
              hasOverlap,
              hasMissingReservation,
              hasMissingFinancialAgreement,
              failedFinancialAgreementId: failedFinancialAgreement?.id ?? null,
            } as Prisma.InputJsonValue,
          },
        });
        return { processId: full.id, status: 'REQUIRES_ATTENTION' as const };
      }

      const additionalActiveStudents = await countAdditionalActiveStudentsForFutureEnrollments(tx, {
        contaId: input.contaId,
        futureIds,
      });
      await assertStudentCapacity({
        tx,
        contaId: input.contaId,
        additionalActiveStudents,
        operation: 'renewal.future-cycle.activate',
      });

      await tx.matricula.updateMany({
        where: { contaId: input.contaId, id: { in: sourceIds } },
        data: { status: 'ENCERRADA', statusContrato: 'EXPIRADO' },
      });
      await tx.matricula.updateMany({
        where: { contaId: input.contaId, id: { in: futureIds } },
        data: { status: 'ATIVA' },
      });
      await tx.reservaVagaFutura.updateMany({
        where: { contaId: input.contaId, processoId: full.id, status: 'RESERVED' },
        data: { status: 'CONVERTED', convertedAt: now },
      });
      await tx.contratoFuturo.updateMany({
        where: { contaId: input.contaId, processoId: full.id, status: { in: ['SIGNED_SCHEDULED', 'WAITING_SIGNATURE', 'DRAFT'] } },
        data: { status: 'ACTIVE' },
      });
      await tx.acordoFinanceiroFuturo.updateMany({
        where: { contaId: input.contaId, processoId: full.id, status: 'SCHEDULED' },
        data: { status: 'READY_TO_PROVISION' },
      });
      await tx.rematriculaProcesso.update({
        where: { id: full.id },
        data: { status: 'EFFECTIVE' },
      });
      await tx.rematriculaAuditLog.create({
        data: {
          contaId: input.contaId,
          processoId: full.id,
          action: 'FUTURE_CYCLE_ACTIVATED',
          metadata: {
            sourceEnrollmentIds: sourceIds,
            futureEnrollmentIds: futureIds,
            sourceStatus: 'ENCERRADA',
            futureStatus: 'ATIVA',
          } as Prisma.InputJsonValue,
        },
      });
      return { processId: full.id, status: 'EFFECTIVE' as const };
    });
    results.push(result);
  }

  return results;
}

export async function editRenewalFutureLink(
  input: EditRenewalFutureLinkInput,
  deps: { prisma: PrismaClient },
) {
  if (!input.reason.trim()) {
    throw new Error('JUSTIFICATIVA_OBRIGATORIA');
  }

  return deps.prisma.$transaction(async (tx) => {
    const processo = await tx.rematriculaProcesso.findFirst({
      where: { id: input.processId, contaId: input.contaId },
      include: {
        itens: {
          include: {
            matriculaFutura: {
              select: {
                id: true,
                turmaId: true,
                comboId: true,
                planoId: true,
                dataInicio: true,
                dataFimContrato: true,
                taxaMatricula: true,
                taxaIsenta: true,
                taxaJustificativa: true,
                formaPagamento: true,
                formaPagamentoTaxa: true,
                vencimentoDia: true,
                jurosMensal: true,
                multaPercentual: true,
                descontoAntecipado: true,
                prazoDesconto: true,
              },
            },
          },
        },
        financeiros: true,
        contratos: true,
      },
    });
    if (!processo) throw new Error('REMATRICULA_NAO_ENCONTRADA');
    if (['CANCELLED', 'EFFECTIVE', 'COMPLETED'].includes(processo.status)) {
      throw new Error('REMATRICULA_NAO_EDITAVEL');
    }
    if (isSameOrAfterDate(new Date(), processo.effectiveAt)) {
      throw new Error('REMATRICULA_NAO_EDITAVEL_APOS_INICIO');
    }

    const renewedItems = processo.itens.filter((item) => item.decision === 'RENEW');
    if (renewedItems.length === 0) throw new Error('SEM_ITENS_RENOVADOS');

    const firstRenewedItem = renewedItems[0];
    const firstFutureEnrollment = firstRenewedItem?.matriculaFutura;
    const currentTargetComboId = firstFutureEnrollment?.comboId ?? firstRenewedItem?.targetComboId ?? null;
    const currentTargetClassId = firstFutureEnrollment?.turmaId ?? firstRenewedItem?.targetClassId ?? null;
    const currentTargetPlanId = firstFutureEnrollment?.planoId ?? firstRenewedItem?.targetPlanId ?? null;

    const targetComboId = input.targetComboId !== undefined ? input.targetComboId : currentTargetComboId;
    const targetClassId = targetComboId
      ? null
      : input.targetClassId !== undefined
        ? input.targetClassId
        : currentTargetClassId;
    const targetPlanId = input.targetPlanId !== undefined ? input.targetPlanId : currentTargetPlanId;

    if (!targetComboId && !targetClassId) {
      throw new Error('DESTINO_OBRIGATORIO');
    }
    if (!targetComboId && !targetPlanId) {
      throw new Error('PLANO_DESTINO_OBRIGATORIO');
    }

    const [targetClass, targetCombo, targetPlan] = await Promise.all([
      targetClassId
        ? tx.turma.findFirst({
            where: { id: targetClassId, contaId: input.contaId, status: 'ATIVO' },
            select: { id: true, nome: true },
          })
        : null,
      targetComboId
        ? tx.combo.findFirst({
            where: { id: targetComboId, contaId: input.contaId, status: 'ATIVO' },
            select: { id: true, nome: true, valor: true },
          })
        : null,
      targetPlanId
        ? tx.plano.findFirst({
            where: { id: targetPlanId, contaId: input.contaId, status: 'ATIVO' },
            select: { id: true, nome: true, valor: true },
          })
        : null,
    ]);

    if (targetClassId && !targetClass) throw new Error('TURMA_DESTINO_INVALIDA');
    if (targetComboId && !targetCombo) throw new Error('COMBO_DESTINO_INVALIDO');
    if (!targetComboId && targetPlanId && !targetPlan) throw new Error('PLANO_DESTINO_INVALIDO');

    const capacityInput: RenewalProcessInput = {
      contaId: input.contaId,
      actorId: input.actorId,
      origin: processo.origin,
      campaignId: processo.campanhaId,
      targetPeriodId: processo.targetPeriodId,
      holderType: input.holderType ?? processo.holderType,
      holderId: input.holderId ?? processo.holderId,
      effectiveAt: input.effectiveAt ?? processo.effectiveAt,
      firstDueDate: input.firstDueDate ?? processo.firstDueDate,
      items: renewedItems.map((item) => ({
        decision: 'RENEW' as const,
        sourceEnrollmentId: item.matriculaOrigemId,
        target: targetComboId
          ? { type: 'COMBO' as const, targetId: targetComboId, planId: targetPlanId ?? targetComboId }
          : { type: 'CLASS' as const, targetId: targetClassId!, planId: targetPlanId! },
      })),
    };
    const capacityTargets = await resolveTargets(tx, input.contaId, capacityInput.items);
    const capacityBlockers = await validateRenewalCapacity(
      tx,
      capacityInput,
      input.effectiveAt ?? processo.effectiveAt,
      capacityTargets,
    );
    if (capacityBlockers.length > 0) {
      throw new Error(capacityBlockers[0]?.message ?? 'Destino futuro sem vagas disponÃ­veis.');
    }

    const beforeState = {
      processo: {
        id: processo.id,
        version: processo.version,
        effectiveAt: processo.effectiveAt.toISOString(),
        firstDueDate: processo.firstDueDate?.toISOString() ?? null,
        monthlyTotal: Number(processo.monthlyTotal.toString()),
        enrollmentFeeTotal: Number(processo.enrollmentFeeTotal.toString()),
        holderType: processo.holderType,
        holderId: processo.holderId,
      },
      itens: renewedItems.map((item) => ({
        id: item.id,
        targetClassId: item.targetClassId,
        targetComboId: item.targetComboId,
        targetPlanId: item.targetPlanId,
        effectiveAt: item.effectiveAt?.toISOString() ?? null,
      })),
      financeiros: processo.financeiros.map((financeiro) => ({
        id: financeiro.id,
        monthlyTotal: Number(financeiro.monthlyTotal.toString()),
        enrollmentFeeTotal: Number(financeiro.enrollmentFeeTotal.toString()),
        firstDueDate: financeiro.firstDueDate?.toISOString() ?? null,
        effectiveAt: financeiro.effectiveAt.toISOString(),
        feeChargeMoment: financeiro.feeChargeMoment,
        feeUnit: financeiro.feeUnit,
        feePurpose: financeiro.feePurpose,
      })),
    };

    const firstFutureFinancial = processo.financeiros[0];
    const firstFutureContract = processo.contratos[0];
    const effectiveAt = input.effectiveAt ?? firstFutureEnrollment?.dataInicio ?? processo.effectiveAt;
    const firstDueDate = input.firstDueDate ?? firstFutureFinancial?.firstDueDate ?? processo.firstDueDate;
    const targetContractEndsAt =
      input.targetContractEndsAt ??
      firstFutureEnrollment?.dataFimContrato ??
      firstFutureContract?.validUntil ??
      addYears(effectiveAt, 1);
    const unitMonthlyAmount =
      input.monthlyAmount ??
      Number((targetCombo?.valor ?? targetPlan?.valor ?? 0).toString());
    const monthlyTotal = unitMonthlyAmount * renewedItems.length;
    const enrollmentFeeAmount =
      input.enrollmentFeeExempt === true
        ? 0
        : input.enrollmentFeeAmount ??
          (firstFutureEnrollment?.taxaMatricula != null
            ? toMoney(firstFutureEnrollment.taxaMatricula)
            : undefined) ??
          Number(processo.enrollmentFeeTotal.toString());
    const currentFeeUnit = firstFutureFinancial?.feeUnit ?? 'PER_STUDENT';
    const nextFeeUnit = input.feeUnit ?? currentFeeUnit;
    const nextFeeChargeMoment =
      input.feeChargeMoment ??
      (firstFutureFinancial?.feeChargeMoment ?? (enrollmentFeeAmount > 0 ? 'CHARGE_ON_START' : 'EXEMPT'));
    const enrollmentFeeTotal =
      nextFeeUnit === 'PER_FAMILY'
        ? enrollmentFeeAmount
        : nextFeeUnit === 'NO_FEE' || nextFeeChargeMoment === 'EXEMPT'
          ? 0
          : enrollmentFeeAmount * renewedItems.length;
    const enrollmentFeeExempt =
      input.enrollmentFeeExempt ?? enrollmentFeeTotal <= 0;
    const feeChargeMoment = enrollmentFeeExempt ? 'EXEMPT' : nextFeeChargeMoment;
    const feeUnit = enrollmentFeeExempt ? 'NO_FEE' : nextFeeUnit;
    const feePurpose = input.feePurpose ?? firstFutureFinancial?.feePurpose ?? 'ADMINISTRATIVE_FEE';

    const futureIds = renewedItems
      .map((item) => item.matriculaFuturaId)
      .filter((id): id is string => Boolean(id));

    const futureEnrollmentUpdateData = {
      turmaId: targetClassId,
      comboId: targetComboId,
      planoId: targetComboId ? null : targetPlanId,
      dataInicio: effectiveAt,
      dataFimContrato: targetContractEndsAt,
      taxaMatricula: enrollmentFeeAmount,
      taxaIsenta: enrollmentFeeExempt,
      taxaStatus: enrollmentFeeExempt ? ('ISENTO' as const) : ('PENDENTE' as const),
      taxaJustificativa:
        input.enrollmentFeeJustification !== undefined
          ? input.enrollmentFeeJustification
          : firstFutureEnrollment?.taxaJustificativa,
      formaPagamento:
        input.paymentMethod !== undefined
          ? input.paymentMethod
          : firstFutureEnrollment?.formaPagamento ?? undefined,
      formaPagamentoTaxa:
        input.enrollmentFeePaymentMethod !== undefined
          ? input.enrollmentFeePaymentMethod
          : input.paymentMethod !== undefined
            ? input.paymentMethod
            : firstFutureEnrollment?.formaPagamentoTaxa ?? undefined,
      vencimentoDia:
        input.dueDay !== undefined
          ? input.dueDay ?? undefined
          : firstFutureEnrollment?.vencimentoDia ?? undefined,
      jurosMensal:
        input.interestMonthlyPercent !== undefined
          ? input.interestMonthlyPercent
          : firstFutureEnrollment?.jurosMensal,
      multaPercentual:
        input.lateFeePercent !== undefined
          ? input.lateFeePercent
          : firstFutureEnrollment?.multaPercentual,
      descontoAntecipado:
        input.earlyDiscountPercent !== undefined
          ? input.earlyDiscountPercent
          : firstFutureEnrollment?.descontoAntecipado,
      prazoDesconto:
        input.earlyDiscountDays !== undefined
          ? input.earlyDiscountDays
          : firstFutureEnrollment?.prazoDesconto,
      ...(input.holderType === 'RESPONSIBLE' && input.holderId
        ? { responsavelFinanceiroId: input.holderId }
        : {}),
    };

    await tx.matricula.updateMany({
      where: { contaId: input.contaId, id: { in: futureIds } },
      data: futureEnrollmentUpdateData,
    });

    await tx.rematriculaItem.updateMany({
      where: { contaId: input.contaId, processoId: processo.id, decision: 'RENEW' },
      data: {
        targetType: targetComboId ? 'COMBO' : 'CLASS',
        targetClassId,
        targetComboId,
        targetPlanId: targetComboId ? null : targetPlanId,
        effectiveAt,
        targetSnapshot: {
          type: targetComboId ? 'COMBO' : 'CLASS',
          targetId: targetComboId ?? targetClassId,
          planId: targetPlanId,
          className: targetClass?.nome ?? null,
          comboName: targetCombo?.nome ?? null,
          planName: targetPlan?.nome ?? null,
          editedAt: new Date().toISOString(),
          editedById: input.actorId,
        } as Prisma.InputJsonValue,
      },
    });

    await tx.reservaVagaFutura.updateMany({
      where: { contaId: input.contaId, processoId: processo.id, status: { in: ['RESERVED', 'WAITLISTED'] } },
      data: {
        targetClassId,
        effectiveAt,
        status: 'RESERVED',
      },
    });

    if (input.contractModelId !== undefined) {
      await tx.contratoFuturo.updateMany({
        where: { contaId: input.contaId, processoId: processo.id },
        data: {
          contractModelId: input.contractModelId,
          status: input.contractModelId ? 'WAITING_SIGNATURE' : 'DRAFT',
          validFrom: effectiveAt,
          validUntil: targetContractEndsAt,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.contratoFuturo.updateMany({
        where: { contaId: input.contaId, processoId: processo.id },
        data: {
          validFrom: effectiveAt,
          validUntil: targetContractEndsAt,
          version: { increment: 1 },
        },
      });
    }

    await tx.acordoFinanceiroFuturo.updateMany({
      where: {
        contaId: input.contaId,
        processoId: processo.id,
        status: { in: ['SCHEDULED', 'READY_TO_PROVISION', 'FAILED'] },
      },
      data: {
        status: 'SCHEDULED',
        monthlyTotal,
        enrollmentFeeTotal,
        firstDueDate,
        effectiveAt,
        provisionAt: new Date(effectiveAt.getTime() - 10 * 24 * 60 * 60 * 1000),
        feeChargeMoment,
        feeUnit,
        feePurpose,
        failureCode: null,
        failureMessage: null,
        snapshot: {
          editedAt: new Date().toISOString(),
          editedById: input.actorId,
          monthlyTotal,
          enrollmentFeeTotal,
          firstDueDate: firstDueDate?.toISOString() ?? null,
          targetClassId,
          targetComboId,
          targetPlanId,
          targetContractEndsAt: targetContractEndsAt.toISOString(),
          paymentMethod: futureEnrollmentUpdateData.formaPagamento ?? null,
          enrollmentFeePaymentMethod: futureEnrollmentUpdateData.formaPagamentoTaxa ?? null,
          dueDay: futureEnrollmentUpdateData.vencimentoDia ?? null,
          enrollmentFeeAmount,
          enrollmentFeeExempt,
          enrollmentFeeJustification: futureEnrollmentUpdateData.taxaJustificativa ?? null,
          lateFeePercent:
            futureEnrollmentUpdateData.multaPercentual == null
              ? null
              : toMoney(futureEnrollmentUpdateData.multaPercentual),
          interestMonthlyPercent:
            futureEnrollmentUpdateData.jurosMensal == null
              ? null
              : toMoney(futureEnrollmentUpdateData.jurosMensal),
          earlyDiscountPercent:
            futureEnrollmentUpdateData.descontoAntecipado == null
              ? null
              : toMoney(futureEnrollmentUpdateData.descontoAntecipado),
          earlyDiscountDays: futureEnrollmentUpdateData.prazoDesconto ?? null,
          feeChargeMoment,
          feeUnit,
          feePurpose,
        } as Prisma.InputJsonValue,
      },
    });

    const updated = await tx.rematriculaProcesso.update({
      where: { id: processo.id },
      data: {
        holderType: input.holderType ?? processo.holderType,
        holderId: input.holderId ?? processo.holderId,
        effectiveAt,
        firstDueDate,
        monthlyTotal,
        enrollmentFeeTotal,
        status: processo.status === 'REQUIRES_ATTENTION' ? 'CONFIRMED' : processo.status,
        version: { increment: 1 },
        updatedById: input.actorId,
      },
      select: {
        id: true,
        status: true,
        version: true,
        effectiveAt: true,
        firstDueDate: true,
        monthlyTotal: true,
        enrollmentFeeTotal: true,
      },
    });

    const afterState = {
      ...updated,
      effectiveAt: updated.effectiveAt.toISOString(),
      firstDueDate: updated.firstDueDate?.toISOString() ?? null,
      monthlyTotal: Number(updated.monthlyTotal.toString()),
      enrollmentFeeTotal: Number(updated.enrollmentFeeTotal.toString()),
    };

    await tx.rematriculaProcessoRevisao.create({
      data: {
        contaId: input.contaId,
        processoId: processo.id,
        version: updated.version,
        reason: input.reason,
        actorId: input.actorId,
        beforeState: beforeState as Prisma.InputJsonValue,
        afterState: afterState as Prisma.InputJsonValue,
      },
    });

    await tx.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        processoId: processo.id,
        actorId: input.actorId,
        action: 'FUTURE_LINK_UPDATED',
        reason: input.reason,
        beforeState: beforeState as Prisma.InputJsonValue,
        afterState: afterState as Prisma.InputJsonValue,
      },
    });

    return {
      processId: updated.id,
      status: updated.status,
      version: updated.version,
    };
  });
}

export async function provisionFutureFinancialAgreements(
  input: { contaId: string; now?: Date; limit?: number },
  deps: { prisma: PrismaClient },
) {
  return enqueueFutureFinancialProvisioning(input, deps);
}

async function countAdditionalActiveStudentsForFutureEnrollments(
  tx: Prisma.TransactionClient,
  input: { contaId: string; futureIds: string[] },
): Promise<number> {
  if (input.futureIds.length === 0) return 0;

  const futures = await tx.matricula.findMany({
    where: {
      contaId: input.contaId,
      id: { in: input.futureIds },
      aluno: { status: 'ATIVO' },
    },
    distinct: ['alunoId'],
    select: { alunoId: true },
  });

  let additional = 0;
  for (const future of futures) {
    const activeEnrollment = await tx.matricula.findFirst({
      where: {
        contaId: input.contaId,
        alunoId: future.alunoId,
        status: 'ATIVA',
        id: { notIn: input.futureIds },
      },
      select: { id: true },
    });
    if (!activeEnrollment) additional += 1;
  }

  return additional;
}
