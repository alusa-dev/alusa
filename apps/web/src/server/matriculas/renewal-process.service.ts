import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  buildRenewalPreview,
  type RenewalItemInput,
  type RenewalOrigin,
  type RenewalHolderType,
} from '@alusa/domain';
import { buildSeatOccupancyWhereClause } from '@alusa/lib';
import { createRenewalPending } from './renewal-governance.service';
import { enqueueFutureFinancialProvisioning } from './renewal-outbox.service';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

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
  contractModelId?: string | null;
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
          message: 'Rematrícula de campanha exige campanha vinculada.',
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
          message: 'Campanha não encontrada para este período.',
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
          message: 'A campanha precisa estar ativa para iniciar ou confirmar rematrículas.',
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
    if (!participant) {
      return [
        {
          sourceEnrollmentId,
          code: 'CAMPAIGN_PARTICIPANT_REQUIRED',
          message: 'O vínculo não faz parte do público elegível desta campanha.',
        },
      ];
    }
    if (participant.status !== 'ELIGIBLE') {
      return [
        {
          sourceEnrollmentId,
          code: 'CAMPAIGN_PARTICIPANT_NOT_ELIGIBLE',
          message: 'O participante não está elegível nesta campanha.',
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
    },
    blockers,
  };
}

async function findDuplicateRenewalItems(
  prisma: PrismaLike,
  input: RenewalProcessInput,
  excludeProcessId?: string | null,
) {
  const sourceIds = Array.from(new Set(input.items.map((item) => item.sourceEnrollmentId)));
  if (sourceIds.length === 0) return [];

  const duplicates = await prisma.rematriculaItem.findMany({
    where: {
      contaId: input.contaId,
      matriculaOrigemId: { in: sourceIds },
      targetPeriodId: input.targetPeriodId,
      processo: {
        status: { notIn: ['CANCELLED'] },
        ...(excludeProcessId ? { id: { not: excludeProcessId } } : {}),
      },
    },
    select: { matriculaOrigemId: true, processoId: true },
  });

  return duplicates.map((item) => ({
    sourceEnrollmentId: item.matriculaOrigemId,
    code: 'DUPLICATE_SOURCE_TARGET_PERIOD',
    message: 'Já existe rematrícula ativa para este vínculo e período de destino.',
  }));
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
          ...buildSeatOccupancyWhereClause(),
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
          message: `Turma futura "${targetClass.nome}" não possui vagas disponíveis.`,
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
          ...buildSeatOccupancyWhereClause(),
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
          message: `Combo futuro "${targetCombo.nome}" não possui vagas disponíveis.`,
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
  const duplicateBlockers = await findDuplicateRenewalItems(deps.prisma, input);
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
            message: 'Plano futuro não encontrado na conta atual.',
          });
        }

        if (item.target.type === 'CLASS') {
          if (!targets.classesById.has(item.target.targetId)) {
            externalBlockers.push({
              sourceEnrollmentId: item.sourceEnrollmentId,
              code: 'TARGET_CLASS_NOT_FOUND',
              message: 'Turma futura não encontrada na conta atual.',
            });
          }
          monthlyAmount = toMoney(targetPlan?.valor);
        } else {
          const targetCombo = targets.combosById.get(item.target.targetId);
          if (!targetCombo) {
            externalBlockers.push({
              sourceEnrollmentId: item.sourceEnrollmentId,
              code: 'TARGET_COMBO_NOT_FOUND',
              message: 'Combo futuro não encontrado na conta atual.',
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
      ...duplicateBlockers,
      ...capacityBlockers,
    ],
  };
}

export async function confirmRenewalProcess(
  input: ConfirmRenewalProcessInput,
  deps: { prisma: PrismaClient },
) {
  const existing = await deps.prisma.rematriculaProcesso.findFirst({
    where: { contaId: input.contaId, idempotencyKey: input.idempotencyKey },
    include: { itens: true },
  });
  if (existing) {
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
    const processStatus = preview.renewCount > 0 ? 'CONFIRMED' : 'COMPLETED';
    const externalReference = externalReferenceForProcess(input.contaId, input.idempotencyKey);

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
        idempotencyKey: input.idempotencyKey,
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
    if (provisionedFinancial.length > 0) {
      await createRenewalPending(
        {
          contaId: input.contaId,
          processoId: processo.id,
          type: 'MANUAL_REVIEW',
          severity: 'BLOCKER',
          code: 'FUTURE_FINANCE_REMOTE_CANCEL_REQUIRED',
          title: 'Cancelamento financeiro remoto pendente',
          message:
            'A rematrícula futura foi cancelada localmente, mas existe cobrança ou assinatura futura já provisionada para cancelar/reconciliar no Asaas.',
          rule: 'cancelamento_financeiro_futuro',
          impact:
            'O vínculo atual foi preservado; a equipe financeira deve cancelar ou reconciliar os efeitos futuros provisionados.',
          metadata: {
            financialAgreementIds: provisionedFinancial.map((financeiro) => financeiro.id),
            asaasPaymentIds: provisionedFinancial.map((financeiro) => financeiro.asaasPaymentId).filter(Boolean),
            asaasSubscriptionIds: provisionedFinancial
              .map((financeiro) => financeiro.asaasSubscriptionId)
              .filter(Boolean),
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
      },
    });

    return { processId: processo.id, status: 'CANCELLED' as const };
  });
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
            title: 'Ativação do próximo ciclo bloqueada',
            message:
              'O job de ativação encontrou sobreposição de contrato atual, reserva futura ausente ou financeiro futuro inconsistente.',
            rule: 'activate_future_cycle',
            impact:
              'A matrícula futura não foi ativada e nenhuma correção automática de turma/contrato foi aplicada.',
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

      await tx.matricula.updateMany({
        where: { contaId: input.contaId, id: { in: sourceIds } },
        data: { status: 'CANCELADA', statusContrato: 'EXPIRADO' },
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
        itens: true,
        financeiros: true,
        contratos: true,
      },
    });
    if (!processo) throw new Error('REMATRICULA_NAO_ENCONTRADA');
    if (['CANCELLED', 'EFFECTIVE', 'COMPLETED'].includes(processo.status)) {
      throw new Error('REMATRICULA_NAO_EDITAVEL');
    }

    const renewedItems = processo.itens.filter((item) => item.decision === 'RENEW');
    if (renewedItems.length === 0) throw new Error('SEM_ITENS_RENOVADOS');

    const targetClassId = input.targetComboId ? null : input.targetClassId;
    const targetComboId = input.targetComboId ?? null;
    const targetPlanId = input.targetPlanId ?? renewedItems[0]?.targetPlanId ?? null;

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
      throw new Error(capacityBlockers[0]?.message ?? 'Destino futuro sem vagas disponíveis.');
    }

    const beforeState = {
      processo: {
        id: processo.id,
        version: processo.version,
        effectiveAt: processo.effectiveAt.toISOString(),
        firstDueDate: processo.firstDueDate?.toISOString() ?? null,
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
    };

    const effectiveAt = input.effectiveAt ?? processo.effectiveAt;
    const firstDueDate = input.firstDueDate ?? processo.firstDueDate;
    const monthlyTotal = Number(
      (targetCombo?.valor ?? targetPlan?.valor ?? processo.monthlyTotal ?? 0).toString(),
    ) * renewedItems.length;

    const futureIds = renewedItems
      .map((item) => item.matriculaFuturaId)
      .filter((id): id is string => Boolean(id));

    await tx.matricula.updateMany({
      where: { contaId: input.contaId, id: { in: futureIds } },
      data: {
        turmaId: targetClassId,
        comboId: targetComboId,
        planoId: targetComboId ? null : targetPlanId,
        dataInicio: effectiveAt,
        ...(input.holderType === 'RESPONSIBLE' && input.holderId
          ? { responsavelFinanceiroId: input.holderId }
          : {}),
      },
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
          version: { increment: 1 },
        },
      });
    } else {
      await tx.contratoFuturo.updateMany({
        where: { contaId: input.contaId, processoId: processo.id },
        data: {
          validFrom: effectiveAt,
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
        firstDueDate,
        effectiveAt,
        provisionAt: new Date(effectiveAt.getTime() - 10 * 24 * 60 * 60 * 1000),
        failureCode: null,
        failureMessage: null,
        snapshot: {
          editedAt: new Date().toISOString(),
          editedById: input.actorId,
          monthlyTotal,
          firstDueDate: firstDueDate?.toISOString() ?? null,
          targetClassId,
          targetComboId,
          targetPlanId,
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
        afterState: {
          ...updated,
          effectiveAt: updated.effectiveAt.toISOString(),
          firstDueDate: updated.firstDueDate?.toISOString() ?? null,
          monthlyTotal: Number(updated.monthlyTotal.toString()),
        } as Prisma.InputJsonValue,
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
