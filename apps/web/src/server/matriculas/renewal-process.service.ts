import { createHash } from 'crypto';
import { Prisma, StatusMatricula, type PrismaClient } from '@prisma/client';
import {
  buildRenewalPreview,
  evaluateRenewalActivation,
  validarConflitosRematricula,
  validarDatasRematricula,
  type RenewalItemInput,
  type RenewalOrigin,
  type RenewalHolderType,
} from '@alusa/domain';
import { AsaasHttpError, deletePayment, deleteSubscription, isAsaasEnabled } from '@alusa/finance';
import {
  buildSeatOccupancyWhereClause,
} from '@alusa/lib';
import { issueEnrollmentContract } from '@/src/server/contracts/issue-enrollment-contract.service';
import { createRenewalPending } from './renewal-governance.service';
import { enqueueFutureFinancialProvisioning } from './renewal-outbox.service';
import {
  compareEnrollmentRecency,
  type EnrollmentChainRow,
  isClosedEnrollmentStatus,
  resolveEnrollmentRootId,
} from './rematricula-chain';
import { assertStudentCapacity } from '@/src/server/platform-billing/capacity';
import { calcularPrecoMatricula, type DescontoInput } from './matricula-pricing';

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
  earlyDiscountPercent?: number | null;
  earlyDiscountDays?: number | null;
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
  sourceHolderId?: string | null;
  items: RenewalItemInput[];
  effectiveAt?: Date | null;
  firstDueDate?: Date | null;
  targetContractEndsAt?: Date | null;
  contractModelId?: string | null;
  financialTerms?: RenewalFinancialTermsInput | null;
  descontos?: Array<{ id: string; cumulativo?: boolean }>;
  futureBillingStrategy?: {
    mode: 'SEPARATE' | 'UNIFY_EXISTING';
    agreementId?: string | null;
  } | null;
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
      turma: {
        select: {
          id: true,
          nome: true,
          contaId: true,
          diasSemana: true,
          horaInicio: true,
          horaFim: true,
        },
      },
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
          select: {
            id: true,
            nome: true,
            capacidade: true,
            updatedAt: true,
            diasSemana: true,
            horaInicio: true,
            horaFim: true,
          },
        })
      : [],
    comboIds.length
      ? prisma.combo.findMany({
          where: { contaId, id: { in: comboIds }, status: 'ATIVO' },
          select: {
            id: true,
            nome: true,
            valor: true,
            periodicidade: true,
            vagasLimite: true,
            updatedAt: true,
            turmas: {
              select: {
                turma: {
                  select: {
                    id: true,
                    nome: true,
                    capacidade: true,
                    diasSemana: true,
                    horaInicio: true,
                    horaFim: true,
                  },
                },
              },
            },
          },
        })
      : [],
  ]);

  return {
    plansById: new Map(plans.map((plan) => [plan.id, plan])),
    classesById: new Map(classes.map((turma) => [turma.id, turma])),
    combosById: new Map(combos.map((combo) => [combo.id, combo])),
  };
}

type RenewalDiscount = DescontoInput & { id: string; nome: string };

async function resolveRenewalDiscounts(prisma: PrismaLike, contaId: string, descontos?: RenewalProcessInput['descontos']) {
  const ids = Array.from(new Set((descontos ?? []).map((item) => item.id).filter(Boolean)));
  if (!ids.length || !('desconto' in prisma) || !prisma.desconto) return [] as RenewalDiscount[];

  const records = await prisma.desconto.findMany({
    where: { contaId, id: { in: ids }, status: 'ATIVO' },
    select: { id: true, nome: true, tipo: true, valor: true },
  });
  if (records.length !== ids.length) throw new Error('Um ou mais descontos selecionados não estão disponíveis.');

  return records.map((record) => ({
    id: record.id,
    nome: record.nome,
    tipo: record.tipo === 'PERCENTUAL' ? 'PERCENTUAL' as const : 'FIXO' as const,
    valor: Number(record.valor),
    cumulativo: descontos?.find((item) => item.id === record.id)?.cumulativo,
  }));
}

function calculateRenewalPrice(baseAmount: number, discounts: RenewalDiscount[]) {
  return calcularPrecoMatricula({ planoValor: baseAmount, descontos: discounts }).planoLiquido;
}

type RenewalBlocker = { sourceEnrollmentId: string; code: string; message: string };

export type RenewalFutureAgreementCandidate = {
  id: string;
  source: 'FUTURE_AGREEMENT' | 'BILLING_AGREEMENT' | 'LEGACY_FAMILY' | 'CURRENT_INDIVIDUAL';
  processId: string;
  status: string;
  monthlyTotal: number;
  enrollmentFeeTotal: number;
  effectiveAt: string;
  periodicity: string | null;
  studentNames: string[];
  canUnify: boolean;
  reason: string | null;
};

type RenewalTargetData = Awaited<ReturnType<typeof resolveTargets>>;

type Schedule = {
  id: string;
  nome: string;
  diasSemana: string[];
  horaInicio: string;
  horaFim: string;
};

function schedulesOverlap(left: Schedule, right: Schedule) {
  const sameDay = left.diasSemana.some((day) => right.diasSemana.includes(day));
  if (!sameDay) return false;

  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  };

  return toMinutes(left.horaInicio) < toMinutes(right.horaFim)
    && toMinutes(right.horaInicio) < toMinutes(left.horaFim);
}

function targetSchedules(
  item: Extract<RenewalItemInput, { decision: 'RENEW' }>,
  targets: RenewalTargetData,
): Schedule[] {
  if (item.target.type === 'CLASS') {
    const target = targets.classesById.get(item.target.targetId);
    return target
      ? [{
          id: target.id,
          nome: target.nome,
          diasSemana: Array.isArray(target.diasSemana) ? target.diasSemana : [],
          horaInicio: target.horaInicio ?? '',
          horaFim: target.horaFim ?? '',
        }]
      : [];
  }

  const combo = targets.combosById.get(item.target.targetId);
  return combo?.turmas.map(({ turma }) => turma) ?? [];
}

async function findFutureAgreementCandidates(
  prisma: PrismaLike,
  input: RenewalProcessInput,
  targets: RenewalTargetData,
): Promise<RenewalFutureAgreementCandidate[]> {
  if (input.holderType !== 'RESPONSIBLE') return [];

  const agreements = 'acordoFinanceiroFuturo' in prisma && prisma.acordoFinanceiroFuturo
    ? await prisma.acordoFinanceiroFuturo.findMany({
    where: {
      contaId: input.contaId,
      responsavelId: input.holderId,
      status: { in: ['SCHEDULED', 'READY_TO_PROVISION', 'FAILED', 'PROVISIONING', 'ACTIVE'] },
      processo: {
        targetPeriodId: input.targetPeriodId,
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
    },
    select: {
      id: true,
      processoId: true,
      status: true,
      monthlyTotal: true,
      enrollmentFeeTotal: true,
      effectiveAt: true,
      matriculaFuturaId: true,
      snapshot: true,
      processo: {
        select: {
          itens: {
            where: { decision: 'RENEW' },
            select: {
              matriculaFutura: {
                select: {
                  aluno: { select: { nome: true } },
                  plano: { select: { periodicidade: true } },
                  combo: { select: { periodicidade: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
      })
    : [];

  const requestedPeriodicities = new Set(
    input.items
      .filter((item): item is Extract<RenewalItemInput, { decision: 'RENEW' }> => item.decision === 'RENEW' && !item.separateBilling)
      .map((item) => item.target.type === 'CLASS'
        ? targets.plansById.get(item.target.planId)?.periodicidade
        : targets.combosById.get(item.target.targetId)?.periodicidade)
      .map((value) => value ? String(value) : null)
      .filter((value): value is string => value !== null),
  );

  const candidates: RenewalFutureAgreementCandidate[] = agreements.map((agreement) => {
    const existingPeriodicities = new Set(
      agreement.processo.itens
        .map((item) => item.matriculaFutura?.combo?.periodicidade ?? item.matriculaFutura?.plano?.periodicidade)
        .map((value) => value ? String(value) : null)
        .filter((value): value is string => value !== null),
    );
    const allPeriodicities = new Set([...requestedPeriodicities, ...existingPeriodicities]);
    const canUnify = agreement.status === 'SCHEDULED' || agreement.status === 'READY_TO_PROVISION' || agreement.status === 'FAILED';
    const reason = !canUnify
      ? 'Este acordo já foi provisionado ou está em processamento; a unificação exige reconciliação financeira.'
      : allPeriodicities.size > 1
        ? 'A periodicidade do novo vínculo é incompatível com a cobrança existente.'
        : null;

    return {
      id: agreement.id,
      source: 'FUTURE_AGREEMENT' as const,
      processId: agreement.processoId,
      status: agreement.status,
      monthlyTotal: toMoney(agreement.monthlyTotal),
      enrollmentFeeTotal: toMoney(agreement.enrollmentFeeTotal),
      effectiveAt: agreement.effectiveAt.toISOString(),
      periodicity: [...allPeriodicities][0] ?? null,
      studentNames: agreement.processo.itens
        .map((item) => item.matriculaFutura?.aluno?.nome)
        .filter((value): value is string => Boolean(value)),
      canUnify: reason === null,
      reason,
    };
  });

  if ('billingAgreement' in prisma && prisma.billingAgreement) {
    const billingAgreements = await prisma.billingAgreement.findMany({
      where: {
        contaId: input.contaId,
        payerType: 'RESPONSAVEL',
        payerId: input.holderId,
        status: { in: ['PENDING_PROVISION', 'ACTIVE', 'REQUIRES_RECONCILIATION'] },
      },
      select: {
        id: true,
        status: true,
        desiredValue: true,
        validFrom: true,
        validUntil: true,
        cycle: true,
        asaasSubscriptionId: true,
        allocations: {
          where: { status: { in: ['SCHEDULED', 'ACTIVE'] } },
          select: {
            netAmount: true,
            aluno: { select: { nome: true } },
            matricula: {
              select: {
                dataInicio: true,
                plano: { select: { periodicidade: true } },
                combo: { select: { periodicidade: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const agreement of billingAgreements) {
      const effectiveAt = input.effectiveAt ?? new Date();
      const isFuture = agreement.validFrom >= effectiveAt || Boolean(agreement.validUntil && agreement.validUntil >= effectiveAt);
      if (!isFuture) continue;

      const existingPeriodicities = new Set(
        agreement.allocations
          .map((allocation) => allocation.matricula.combo?.periodicidade ?? allocation.matricula.plano?.periodicidade)
          .map((value) => value ? String(value) : null)
          .filter((value): value is string => value !== null),
      );
      const allPeriodicities = new Set([...requestedPeriodicities, ...existingPeriodicities]);
      const canUnify = agreement.status === 'PENDING_PROVISION' && !agreement.asaasSubscriptionId && allPeriodicities.size <= 1;
      const reason = agreement.status !== 'PENDING_PROVISION' || agreement.asaasSubscriptionId
        ? 'A cobrança financeira já está ativa ou provisionada; a unificação exige reconciliação financeira.'
        : allPeriodicities.size > 1
          ? 'A periodicidade do novo vínculo é incompatível com a cobrança existente.'
          : null;
      candidates.push({
        id: `billing-agreement:${agreement.id}`,
        source: 'BILLING_AGREEMENT',
        processId: agreement.id,
        status: agreement.status,
        monthlyTotal: toMoney(agreement.desiredValue),
        enrollmentFeeTotal: 0,
        effectiveAt: agreement.validFrom.toISOString(),
        periodicity: agreement.cycle || String([...allPeriodicities][0] ?? '') || null,
        studentNames: agreement.allocations.map((allocation) => allocation.aluno.nome),
        canUnify,
        reason,
      });
    }
  }

  if ('rematriculaFamiliar' in prisma && prisma.rematriculaFamiliar) {
    const legacyRenewals = await prisma.rematriculaFamiliar.findMany({
      where: {
        contaId: input.contaId,
        responsavelId: input.holderId,
        status: { in: ['PENDENTE', 'PROCESSANDO', 'ATIVO', 'PARCIAL'] },
        effectiveAt: { not: null, gte: input.effectiveAt ?? new Date() },
      },
      select: {
        id: true,
        status: true,
        valorMensalidadeTotal: true,
        valorTaxaMatriculaTotal: true,
        effectiveAt: true,
        dataInicio: true,
        standaloneSubscriptionId: true,
        items: { select: { matriculaOrigem: { select: { aluno: { select: { nome: true } } } } } },
      },
      orderBy: { createdAt: 'asc' },
    }) ?? [];
    for (const renewal of legacyRenewals) {
      candidates.push({
        id: `legacy-family:${renewal.id}`,
        source: 'LEGACY_FAMILY',
        processId: renewal.id,
        status: renewal.status,
        monthlyTotal: toMoney(renewal.valorMensalidadeTotal),
        enrollmentFeeTotal: toMoney(renewal.valorTaxaMatriculaTotal),
        effectiveAt: (renewal.effectiveAt ?? renewal.dataInicio ?? new Date()).toISOString(),
        periodicity: null,
        studentNames: renewal.items.map((item) => item.matriculaOrigem.aluno.nome),
        canUnify: false,
        reason: renewal.standaloneSubscriptionId
          ? 'A rematrícula familiar legada possui assinatura remota; use cobrança separada ou faça reconciliação financeira.'
          : 'A rematrícula familiar legada precisa ser migrada para o acordo financeiro canônico antes da unificação.',
      });
    }
  }

  if ('matriculaFamiliar' in prisma && prisma.matriculaFamiliar) {
    const legacyFamilyGroups = await prisma.matriculaFamiliar.findMany({
      where: {
        contaId: input.contaId,
        responsavelId: input.holderId,
        status: { in: ['PENDENTE', 'PROCESSANDO', 'ATIVO', 'PARCIAL'] },
        dataInicio: { not: null, gte: input.effectiveAt ?? new Date() },
      },
      select: {
        id: true,
        status: true,
        valorMensalidadeTotal: true,
        valorTaxaMatriculaTotal: true,
        dataInicio: true,
        standaloneSubscriptionId: true,
        matriculas: { select: { aluno: { select: { nome: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }) ?? [];
    for (const family of legacyFamilyGroups) {
      candidates.push({
        id: `family-group:${family.id}`,
        source: 'LEGACY_FAMILY',
        processId: family.id,
        status: family.status,
        monthlyTotal: toMoney(family.valorMensalidadeTotal),
        enrollmentFeeTotal: toMoney(family.valorTaxaMatriculaTotal),
        effectiveAt: (family.dataInicio ?? new Date()).toISOString(),
        periodicity: null,
        studentNames: family.matriculas.map((item) => item.aluno.nome),
        canUnify: false,
        reason: family.standaloneSubscriptionId
          ? 'O grupo familiar legado possui assinatura remota; use cobrança separada ou faça reconciliação financeira.'
          : 'O grupo familiar legado precisa ser migrado para o acordo financeiro canônico antes da unificação.',
      });
    }
  }

  if ('matricula' in prisma && prisma.matricula) {
    const individualFutureEnrollments = await prisma.matricula.findMany({
      where: {
        contaId: input.contaId,
        responsavelFinanceiroId: input.holderId,
        rematriculadaDeId: null,
        dataInicio: { gte: input.effectiveAt ?? new Date() },
        OR: [{ asaasSubscriptionId: { not: null } }, { pendingAsaasSubscriptionId: { not: null } }],
        status: { notIn: ['CANCELADA', 'ENCERRADA'] },
      },
      select: {
        id: true,
        dataInicio: true,
        asaasSubscriptionId: true,
        pendingAsaasSubscriptionId: true,
        plano: { select: { valor: true, periodicidade: true } },
        combo: { select: { valor: true, periodicidade: true } },
        aluno: { select: { nome: true } },
      },
      orderBy: { createdAt: 'asc' },
    }) ?? [];
    for (const enrollment of individualFutureEnrollments) {
      const periodicity = enrollment.combo?.periodicidade ?? enrollment.plano?.periodicidade;
      const canUnify = !enrollment.asaasSubscriptionId && Boolean(enrollment.pendingAsaasSubscriptionId) && Boolean(periodicity);
      candidates.push({
        id: `current-individual:${enrollment.id}`,
        source: 'CURRENT_INDIVIDUAL',
        processId: enrollment.id,
        status: enrollment.asaasSubscriptionId ? 'ACTIVE' : 'PENDING_PROVISION',
        monthlyTotal: toMoney(enrollment.combo?.valor ?? enrollment.plano?.valor),
        enrollmentFeeTotal: 0,
        effectiveAt: enrollment.dataInicio.toISOString(),
        periodicity: periodicity ? String(periodicity) : null,
        studentNames: enrollment.aluno?.nome ? [enrollment.aluno.nome] : [],
        canUnify: false,
        reason: canUnify
          ? 'A matrícula individual está aguardando provisionamento; a unificação deve ser feita pelo acordo financeiro canônico.'
          : 'A matrícula individual possui cobrança remota ou não possui acordo futuro compatível.',
      });
    }
  }

  return candidates;
}

async function validateRenewalPreconditions(
  prisma: PrismaLike,
  input: RenewalProcessInput,
  sourceRows: LoadedSource[],
  targets: RenewalTargetData,
  effectiveAt: Date,
): Promise<RenewalBlocker[]> {
  const blockers: RenewalBlocker[] = [];
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const sourceIds = Array.from(new Set(input.items.map((item) => item.sourceEnrollmentId)));
  const expectedSourceHolderId = input.sourceHolderId ?? input.holderId;

  if (input.holderType === 'RESPONSIBLE') {
    const holder = 'responsavel' in prisma && prisma.responsavel
      ? await prisma.responsavel.findFirst({
          where: { id: input.holderId, contaId: input.contaId },
          select: { id: true },
        })
      : { id: input.holderId };
    if (!holder) {
      blockers.push({
        sourceEnrollmentId: 'process',
        code: 'RESPONSIBLE_NOT_FOUND',
        message: 'Responsável financeiro não encontrado nesta conta.',
      });
    }

    for (const source of sourceRows) {
      if (source.responsavelFinanceiroId !== expectedSourceHolderId) {
        blockers.push({
          sourceEnrollmentId: source.id,
          code: 'RESPONSIBLE_MISMATCH',
          message: 'A matrícula não pertence ao responsável financeiro informado.',
        });
      }
    }

    if (input.holderId !== expectedSourceHolderId && sourceRows.length > 0) {
      const linkedStudents = 'alunoResponsavel' in prisma && prisma.alunoResponsavel
        ? await prisma.alunoResponsavel.findMany({
        where: {
          contaId: input.contaId,
          responsavelId: input.holderId,
          alunoId: { in: sourceRows.map((source) => source.alunoId) },
        },
        select: { alunoId: true },
          })
        : [];
      const linkedStudentIds = new Set(linkedStudents.map((link) => link.alunoId));
      for (const source of sourceRows) {
        if (!linkedStudentIds.has(source.alunoId)) {
          blockers.push({
            sourceEnrollmentId: source.id,
            code: 'NEW_RESPONSIBLE_NOT_LINKED',
            message: 'O novo responsável não está vinculado a este aluno.',
          });
        }
      }
    }
  }

  const latestContractEnd = sourceRows.length > 0
    ? new Date(Math.max(...sourceRows.map((source) => source.dataFimContrato.getTime())))
    : null;
  if (latestContractEnd && input.effectiveAt && input.targetContractEndsAt) {
    const dateValidation = validarDatasRematricula({
      dataFimContratoOrigem: latestContractEnd,
      novaDataInicio: input.effectiveAt,
      novaDataFimContrato: input.targetContractEndsAt,
    });
    if (!dateValidation.success) {
      blockers.push({
        sourceEnrollmentId: 'process',
        code: dateValidation.error,
        message:
          dateValidation.error === 'DATA_INICIO_INVALIDA'
            ? 'A data de início não pode anteceder o fim do contrato atual.'
            : 'A data final do contrato deve ser posterior à data de início.',
      });
    }
  }

  const renewedItems = input.items.filter(
    (item): item is Extract<RenewalItemInput, { decision: 'RENEW' }> => item.decision === 'RENEW',
  );
  const sharedPeriodicities = new Set<string>();
  for (const item of renewedItems) {
    const target = item.target.type === 'CLASS'
      ? targets.plansById.get(item.target.planId)
      : targets.combosById.get(item.target.targetId);
    if (!target) continue;
    if (!item.separateBilling) sharedPeriodicities.add(String(target.periodicidade));
  }
  if (sharedPeriodicities.size > 1) {
    blockers.push({
      sourceEnrollmentId: 'process',
      code: 'INCOMPATIBLE_BILLING_PERIODICITIES',
      message: 'Os vínculos consolidados precisam utilizar a mesma periodicidade financeira.',
    });
  }

  const currentEnrollmentsResult = sourceRows.length > 0
    ? await prisma.matricula.findMany({
        where: {
          contaId: input.contaId,
          alunoId: { in: sourceRows.map((source) => source.alunoId) },
          id: { notIn: sourceIds },
          status: { in: [StatusMatricula.ATIVA, StatusMatricula.PAUSADA, StatusMatricula.AGUARDANDO_CONFIRMACAO] },
          dataInicio: { lte: effectiveAt },
          dataFimContrato: { gte: effectiveAt },
          turmaId: { not: null },
        },
        select: {
          id: true,
          alunoId: true,
          turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } },
        },
      })
    : [];
  const currentEnrollments = Array.isArray(currentEnrollmentsResult) ? currentEnrollmentsResult : [];
  const currentByStudent = new Map<string, Schedule[]>();
  for (const enrollment of currentEnrollments) {
    if (
      !enrollment.turma ||
      !Array.isArray(enrollment.turma.diasSemana) ||
      typeof enrollment.turma.horaInicio !== 'string' ||
      typeof enrollment.turma.horaFim !== 'string'
    ) continue;
    const schedules = currentByStudent.get(enrollment.alunoId) ?? [];
    schedules.push(enrollment.turma);
    currentByStudent.set(enrollment.alunoId, schedules);
  }

  const plannedByStudent = new Map<string, Array<{ itemId: string; schedule: Schedule }>>();
  for (const item of renewedItems) {
    const source = sourceById.get(item.sourceEnrollmentId);
    if (!source) continue;
    const planned = plannedByStudent.get(source.alunoId) ?? [];
    for (const schedule of targetSchedules(item, targets)) {
      planned.push({ itemId: item.sourceEnrollmentId, schedule });
    }
    plannedByStudent.set(source.alunoId, planned);
  }

  for (const item of renewedItems) {
    const source = sourceById.get(item.sourceEnrollmentId);
    if (!source) continue;
    const nextSchedules = targetSchedules(item, targets);
    if (item.target.type === 'COMBO' && nextSchedules.length === 0) {
      blockers.push({
        sourceEnrollmentId: item.sourceEnrollmentId,
        code: 'TARGET_COMBO_WITHOUT_CLASSES',
        message: 'O combo futuro não possui turmas ativas vinculadas.',
      });
    }

    for (let index = 0; index < nextSchedules.length; index += 1) {
      for (const other of nextSchedules.slice(index + 1)) {
        if (schedulesOverlap(nextSchedules[index]!, other)) {
          blockers.push({
            sourceEnrollmentId: item.sourceEnrollmentId,
            code: 'TARGET_INTERNAL_SCHEDULE_CONFLICT',
            message: `O destino futuro possui conflito entre as turmas "${nextSchedules[index]!.nome}" e "${other.nome}".`,
          });
        }
      }
    }

    const plannedForStudent = plannedByStudent.get(source.alunoId) ?? [];
    for (const nextSchedule of nextSchedules) {
      for (const planned of plannedForStudent) {
        if (planned.itemId <= item.sourceEnrollmentId) continue;
        if (!schedulesOverlap(nextSchedule, planned.schedule)) continue;
        blockers.push({
          sourceEnrollmentId: item.sourceEnrollmentId,
          code: 'TARGET_STUDENT_SCHEDULE_CONFLICT',
          message: `As escolhas futuras do aluno conflitam entre si: "${nextSchedule.nome}" e "${planned.schedule.nome}".`,
        });
      }
    }

    const conflict = validarConflitosRematricula({
      alunoId: source.alunoId,
      novasTurmas: nextSchedules,
      turmasExistentes: currentByStudent.get(source.alunoId) ?? [],
      matriculaIdAtual: source.id,
    });
    if (!conflict.success) {
      blockers.push({
        sourceEnrollmentId: item.sourceEnrollmentId,
        code: conflict.error,
        message: `A turma futura "${conflict.turma1}" conflita com "${conflict.turma2}" para este aluno.`,
      });
    }
  }

  return blockers;
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

    const reservations = await prisma.reservaVagaFutura.findMany({
      where: {
        contaId: input.contaId,
        targetClassId: classId,
        targetPeriodId: input.targetPeriodId,
        status: { in: ['RESERVED', 'WAITLISTED'] },
        matriculaOrigemId: { notIn: sourceIds },
      },
      select: { matriculaFuturaId: true },
    });
    const reservedFutureEnrollmentIds = reservations.flatMap((reservation) =>
      reservation.matriculaFuturaId ? [reservation.matriculaFuturaId] : [],
    );
    const currentOccupancy = await prisma.matricula.count({
      where: {
        contaId: input.contaId,
        turmaId: classId,
        dataFimContrato: { gte: effectiveAt },
        ...buildSeatOccupancyWhereClause(effectiveAt),
        id: { notIn: [...sourceIds, ...reservedFutureEnrollmentIds] },
      },
    });
    const reservedOccupancy = reservations.length;

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
    if (!targetCombo) continue;

    if (targetCombo.turmas.length > 0) {
      const reservedComboItems = await prisma.rematriculaItem.findMany({
        where: {
          contaId: input.contaId,
          targetPeriodId: input.targetPeriodId,
          targetComboId: comboId,
          decision: 'RENEW',
          matriculaOrigemId: { notIn: sourceIds },
          processo: { status: { notIn: ['CANCELLED'] } },
        },
        select: { matriculaFuturaId: true },
      });
      for (const comboClass of targetCombo.turmas) {
        const classOccupancy = await prisma.matricula.count({
          where: {
            contaId: input.contaId,
            OR: [{ turmaId: comboClass.turma.id }, { comboId }],
            dataFimContrato: { gte: effectiveAt },
            ...buildSeatOccupancyWhereClause(effectiveAt),
            id: { notIn: sourceIds },
          },
        });
        if (classOccupancy + reservedComboItems.length + items.length > comboClass.turma.capacidade) {
          blockers.push(
            ...items.map((item) => ({
              sourceEnrollmentId: item.sourceEnrollmentId,
              code: 'TARGET_COMBO_CLASS_FULL',
              message: `A turma "${comboClass.turma.nome}" incluída no combo futuro não possui vagas disponíveis.`,
            })),
          );
        }
      }
    }

    if (!targetCombo.vagasLimite) continue;

    const reservedItems = await prisma.rematriculaItem.findMany({
      where: {
        contaId: input.contaId,
        targetPeriodId: input.targetPeriodId,
        targetComboId: comboId,
        decision: 'RENEW',
        matriculaOrigemId: { notIn: sourceIds },
        processo: { status: { notIn: ['CANCELLED'] } },
      },
      select: { matriculaFuturaId: true },
    });
    const reservedFutureEnrollmentIds = reservedItems.flatMap((item) =>
      item.matriculaFuturaId ? [item.matriculaFuturaId] : [],
    );
    const currentOccupancy = await prisma.matricula.count({
      where: {
        contaId: input.contaId,
        comboId,
        dataFimContrato: { gte: effectiveAt },
        ...buildSeatOccupancyWhereClause(effectiveAt),
        id: { notIn: [...sourceIds, ...reservedFutureEnrollmentIds] },
      },
    });
    const reservedOccupancy = reservedItems.length;

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

async function lockRenewalResources(
  tx: Prisma.TransactionClient,
  input: RenewalProcessInput,
) {
  if (typeof tx.$executeRaw !== 'function') return;

  const resourceKeys = new Set(
    input.items
      .filter((item): item is Extract<RenewalItemInput, { decision: 'RENEW' }> => item.decision === 'RENEW')
      .map((item) => `${item.target.type}:${item.target.targetId}`),
  );
  for (const resourceKey of resourceKeys) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`renewal:${input.contaId}:${input.targetPeriodId}:${resourceKey}`}))
    `;
  }
}

async function materializeFutureContract(
  tx: Prisma.TransactionClient,
  input: {
    contaId: string;
    actorId: string;
    matriculaId: string;
    modeloId: string;
    processoId: string;
    itemId: string;
    sourceEnrollmentId: string;
    validFrom: Date;
    validUntil: Date;
  },
) {
  const existing = await tx.contratoFuturo.findFirst({
    where: { contaId: input.contaId, processoId: input.processoId, itemId: input.itemId },
    select: { id: true, contratoId: true },
  });
  if (existing?.contratoId) return existing.contratoId;

  const { contrato } = await issueEnrollmentContract(tx, {
    contaId: input.contaId,
    matriculaId: input.matriculaId,
    modeloId: input.modeloId,
    actorId: input.actorId,
    expirationDays: 30,
    source: 'RENEWAL',
    onExisting: 'return',
  });
  const futureContractData = {
      contaId: input.contaId,
      processoId: input.processoId,
      itemId: input.itemId,
      matriculaFuturaId: input.matriculaId,
      contractModelId: input.modeloId,
      contratoId: contrato.id,
      status: 'WAITING_SIGNATURE' as const,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      snapshot: {
        contractModelId: input.modeloId,
        sourceEnrollmentId: input.sourceEnrollmentId,
        futureEnrollmentId: input.matriculaId,
        contratoId: contrato.id,
      } as Prisma.InputJsonValue,
  };
  if (existing) {
    await tx.contratoFuturo.update({
      where: { id: existing.id },
      data: {
        contratoId: contrato.id,
        contractModelId: input.modeloId,
        status: 'WAITING_SIGNATURE',
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        snapshot: futureContractData.snapshot,
      },
    });
  } else {
    await tx.contratoFuturo.create({ data: futureContractData });
  }
  return contrato.id;
}

export async function materializePendingRenewalContracts(
  input: { contaId: string; limit?: number },
  deps: { prisma: PrismaClient },
) {
  const pending = await deps.prisma.contratoFuturo.findMany({
    where: {
      contaId: input.contaId,
      contratoId: null,
      contractModelId: { not: null },
      status: { in: ['DRAFT', 'WAITING_SIGNATURE'] },
      processo: { status: { in: ['CONFIRMED', 'WAITING_FOR_START', 'REQUIRES_ATTENTION'] } },
      matriculaFuturaId: { not: null },
      itemId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    take: input.limit ?? 25,
    select: {
      processoId: true,
      itemId: true,
      matriculaFuturaId: true,
      contractModelId: true,
      validFrom: true,
      validUntil: true,
      item: { select: { matriculaOrigemId: true } },
    },
  });

  const results: Array<{ processoId: string; contratoId: string | null; success: boolean; error?: string }> = [];
  for (const contract of pending) {
    try {
      const contratoId = await deps.prisma.$transaction((tx) =>
        materializeFutureContract(tx, {
          contaId: input.contaId,
          actorId: 'RenewalContractScheduler',
          matriculaId: contract.matriculaFuturaId!,
          modeloId: contract.contractModelId!,
          processoId: contract.processoId,
          itemId: contract.itemId!,
          sourceEnrollmentId: contract.item?.matriculaOrigemId ?? '',
          validFrom: contract.validFrom ?? new Date(),
          validUntil: contract.validUntil ?? new Date(),
        }),
      );
      results.push({ processoId: contract.processoId, contratoId, success: true });
    } catch (error) {
      results.push({
        processoId: contract.processoId,
        contratoId: null,
        success: false,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }
  }
  return results;
}

export async function previewRenewalProcess(input: RenewalProcessInput, deps: { prisma: PrismaLike }) {
  const sourceRows = await loadSourceRows(deps.prisma, input.contaId, input.items);
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const targets = await resolveTargets(deps.prisma, input.contaId, input.items);
  const selectedDiscounts = await resolveRenewalDiscounts(deps.prisma, input.contaId, input.descontos);
  const futureAgreementCandidates = await findFutureAgreementCandidates(deps.prisma, input, targets);
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
      futureBillingStrategy: input.futureBillingStrategy ?? { mode: 'SEPARATE', agreementId: null },
      futureAgreementCandidates: futureAgreementCandidates.map((candidate) => ({
        id: candidate.id,
        status: candidate.status,
        monthlyTotal: candidate.monthlyTotal,
        periodicity: candidate.periodicity,
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
          monthlyAmount = calculateRenewalPrice(toMoney(targetPlan?.valor), selectedDiscounts);
        } else {
          const targetCombo = targets.combosById.get(item.target.targetId);
          if (!targetCombo) {
            externalBlockers.push({
              sourceEnrollmentId: item.sourceEnrollmentId,
              code: 'TARGET_COMBO_NOT_FOUND',
              message: 'Combo futuro nÃ£o encontrado na conta atual.',
            });
          }
          monthlyAmount = calculateRenewalPrice(toMoney(targetCombo?.valor ?? targetPlan?.valor), selectedDiscounts);
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
    sourceHolderId: input.sourceHolderId,
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
    enrollmentFeeUnit: input.financialTerms?.feeUnit,
  });

  const effectiveAt = new Date(`${preview.effectiveAt}T00:00:00.000Z`);
  const selectedAgreementId = input.futureBillingStrategy?.agreementId ?? null;
  const selectedCandidate = selectedAgreementId
    ? futureAgreementCandidates.find((candidate) => candidate.id === selectedAgreementId)
    : null;
  if (input.futureBillingStrategy?.mode === 'UNIFY_EXISTING' && !selectedCandidate) {
    externalBlockers.push({
      sourceEnrollmentId: 'process',
      code: 'FUTURE_AGREEMENT_NOT_FOUND',
      message: 'A cobrança futura selecionada para unificação não foi encontrada nesta conta.',
    });
  } else if (input.futureBillingStrategy?.mode === 'UNIFY_EXISTING' && selectedCandidate && !selectedCandidate.canUnify) {
    externalBlockers.push({
      sourceEnrollmentId: 'process',
      code: 'FUTURE_AGREEMENT_NOT_COMPATIBLE',
      message: selectedCandidate.reason ?? 'A cobrança futura selecionada não pode ser unificada.',
    });
  }
  const preconditionBlockers = await validateRenewalPreconditions(
    deps.prisma,
    input,
    sourceRows,
    targets,
    effectiveAt,
  );

  const capacityBlockers =
    preview.blockers.length || externalBlockers.length
      ? []
      : await validateRenewalCapacity(deps.prisma, input, effectiveAt, targets);

  return {
    ...preview,
    futureAgreementCandidates,
    blockers: [
      ...preview.blockers,
      ...preconditionBlockers,
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

  try {
    return await deps.prisma.$transaction(async (tx) => {
    await lockRenewalResources(tx, input);
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
    const selectedDiscounts = await resolveRenewalDiscounts(tx, input.contaId, input.descontos);
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
            responsavelFinanceiroId:
              input.holderType === 'RESPONSIBLE' ? input.holderId : source.responsavelFinanceiroId,
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
            descontoAntecipado: input.financialTerms?.earlyDiscountPercent ?? source.descontoAntecipado,
            prazoDesconto: input.financialTerms?.earlyDiscountDays ?? source.prazoDesconto,
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
        const targetBaseAmount = item.target.type === 'CLASS'
          ? toMoney(targets.plansById.get(item.target.planId)?.valor)
          : toMoney(targets.combosById.get(item.target.targetId)?.valor);
        const discountRows = selectedDiscounts
          .map((discount) => ({
            descontoId: discount.id,
            valorFinal: discount.tipo === 'PERCENTUAL'
              ? Math.min(targetBaseAmount, toMoney(targetBaseAmount * discount.valor / 100))
              : Math.min(targetBaseAmount, toMoney(discount.valor)),
          }))
          .sort((left, right) => right.valorFinal - left.valorFinal);
        const appliedDiscountRows = selectedDiscounts.some((discount) => discount.cumulativo)
          ? discountRows
          : discountRows.slice(0, 1);
        if (appliedDiscountRows.length) {
          await tx.descontoMatricula.createMany({
            data: appliedDiscountRows.map((discount) => ({
              matriculaId: futureEnrollmentId,
              descontoId: discount.descontoId,
              valorFinal: new Prisma.Decimal(discount.valorFinal),
            })),
            skipDuplicates: true,
          });
        }
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
          await materializeFutureContract(tx, {
            contaId: input.contaId,
            actorId: input.actorId,
            matriculaId: futureEnrollmentId,
            modeloId: input.contractModelId,
            processoId: processo.id,
            itemId: createdItem.id,
            sourceEnrollmentId: source.id,
            validFrom: effectiveAt,
            validUntil: targetContractEndsAt,
          });
        }
      }
    }

    if (preview.renewCount > 0) {
      const feeChargeMoment = input.financialTerms?.feeChargeMoment ?? 'CHARGE_ON_START';
      const configuredFeeUnit = input.financialTerms?.feeUnit
        ?? (preview.enrollmentFeeTotal > 0 ? 'PER_STUDENT' : 'NO_FEE');
      const renewedItems = input.items.filter(
        (item): item is Extract<RenewalItemInput, { decision: 'RENEW' }> => item.decision === 'RENEW',
      );
      const feePerStudent = configuredFeeUnit === 'PER_FAMILY' || configuredFeeUnit === 'NO_FEE'
        ? 0
        : preview.renewCount > 0
          ? toMoney(Number(preview.enrollmentFeeTotal) / preview.renewCount)
          : 0;
      const familyFee = configuredFeeUnit === 'PER_FAMILY' ? toMoney(preview.enrollmentFeeTotal) : 0;
      const groups = new Map<string, {
        items: typeof renewedItems;
        monthlyTotal: number;
        enrollmentFeeTotal: number;
      }>();
      for (const item of renewedItems) {
        const key = item.separateBilling ? `ITEM:${item.sourceEnrollmentId}` : 'SHARED';
        const current = groups.get(key) ?? { items: [], monthlyTotal: 0, enrollmentFeeTotal: 0 };
            const targetValue = calculateRenewalPrice(
              toMoney(item.target.type === 'CLASS'
                ? targets.plansById.get(item.target.planId)?.valor
                : targets.combosById.get(item.target.targetId)?.valor),
              selectedDiscounts,
            );
        current.items.push(item);
        current.monthlyTotal = toMoney(current.monthlyTotal + targetValue);
        current.enrollmentFeeTotal = toMoney(
          current.enrollmentFeeTotal
            + (configuredFeeUnit === 'PER_FAMILY' ? 0 : feePerStudent),
        );
        groups.set(key, current);
      }

      if (familyFee > 0) {
        const shared = groups.get('SHARED');
        if (shared) shared.enrollmentFeeTotal = familyFee;
        else {
          const firstGroup = groups.values().next().value as {
            enrollmentFeeTotal: number;
          } | undefined;
          if (firstGroup) firstGroup.enrollmentFeeTotal = familyFee;
        }
      }

      let groupIndex = 0;
      for (const [groupKey, group] of groups) {
        const selectedExistingAgreementId = input.futureBillingStrategy?.mode === 'UNIFY_EXISTING'
          ? input.futureBillingStrategy.agreementId
          : null;
        const selectedBillingAgreementId = groupKey === 'SHARED' && selectedExistingAgreementId?.startsWith('billing-agreement:')
          ? selectedExistingAgreementId.slice('billing-agreement:'.length)
          : null;
        const existingAgreement = groupKey === 'SHARED' && selectedExistingAgreementId
          && !selectedBillingAgreementId
          ? await tx.acordoFinanceiroFuturo.findFirst({
              where: {
                id: selectedExistingAgreementId,
                contaId: input.contaId,
                responsavelId: input.holderType === 'RESPONSIBLE' ? input.holderId : null,
                processo: { targetPeriodId: input.targetPeriodId, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
                status: { in: ['SCHEDULED', 'READY_TO_PROVISION', 'FAILED'] },
              },
              select: {
                id: true,
                processoId: true,
                status: true,
                monthlyTotal: true,
                enrollmentFeeTotal: true,
                snapshot: true,
              },
            })
          : null;
        const existingBillingAgreement = selectedBillingAgreementId
          ? await tx.billingAgreement.findFirst({
              where: {
                id: selectedBillingAgreementId,
                contaId: input.contaId,
                payerType: 'RESPONSAVEL',
                payerId: input.holderId,
                status: 'PENDING_PROVISION',
                asaasSubscriptionId: null,
              },
              select: {
                id: true,
                status: true,
                desiredValue: true,
                validFrom: true,
                validUntil: true,
                version: true,
              },
            })
          : null;

        if (groupKey === 'SHARED' && selectedExistingAgreementId && !existingAgreement && !existingBillingAgreement) {
          throw new Error('FUTURE_AGREEMENT_NOT_COMPATIBLE');
        }

        if (existingBillingAgreement) {
          const contribution = {
            processId: processo.id,
            monthlyTotal: group.monthlyTotal,
            sourceEnrollmentIds: group.items.map((item) => item.sourceEnrollmentId),
          };
          const updatedDesiredValue = toMoney(Number(existingBillingAgreement.desiredValue) + group.monthlyTotal);

          await tx.billingAgreement.update({
            where: { id: existingBillingAgreement.id },
            data: {
              desiredValue: updatedDesiredValue,
              version: { increment: 1 },
            },
          });

          for (const item of group.items) {
            const futureEnrollment = await tx.rematriculaItem.findFirst({
              where: { processoId: processo.id, matriculaOrigemId: item.sourceEnrollmentId },
              select: { matriculaFuturaId: true, matriculaFutura: { select: { alunoId: true } } },
            });
            if (!futureEnrollment?.matriculaFuturaId || !futureEnrollment.matriculaFutura?.alunoId) {
              throw new Error('REMATRICULA_FUTURA_NAO_ENCONTRADA');
            }
            const targetValue = calculateRenewalPrice(
              toMoney(item.target.type === 'CLASS'
                ? targets.plansById.get(item.target.planId)?.valor
                : targets.combosById.get(item.target.targetId)?.valor),
              selectedDiscounts,
            );
            await tx.billingAllocation.create({
              data: {
                contaId: input.contaId,
                agreementId: existingBillingAgreement.id,
                matriculaId: futureEnrollment.matriculaFuturaId,
                alunoId: futureEnrollment.matriculaFutura.alunoId,
                kind: 'TUITION',
                status: 'SCHEDULED',
                recurring: true,
                baseAmount: toMoney(targetValue),
                discountAmount: toMoney(
                  toMoney(item.target.type === 'CLASS'
                    ? targets.plansById.get(item.target.planId)?.valor
                    : targets.combosById.get(item.target.targetId)?.valor) - targetValue,
                ),
                netAmount: toMoney(targetValue),
                validFrom: effectiveAt,
                validUntil: input.targetContractEndsAt ?? existingBillingAgreement.validUntil,
                prorationPolicy: 'NEXT_CYCLE',
                metadata: { processId: processo.id, sourceEnrollmentId: item.sourceEnrollmentId } as Prisma.InputJsonValue,
              },
            });
          }

          const proxy = await tx.acordoFinanceiroFuturo.create({
            data: {
              contaId: input.contaId,
              processoId: processo.id,
              matriculaFuturaId: group.items.length === 1
                ? (await tx.rematriculaItem.findFirst({
                    where: { processoId: processo.id, matriculaOrigemId: group.items[0]!.sourceEnrollmentId },
                    select: { matriculaFuturaId: true },
                  }))?.matriculaFuturaId ?? null
                : null,
              responsavelId: input.holderType === 'RESPONSIBLE' ? input.holderId : null,
              status: 'ACTIVE',
              monthlyTotal: group.monthlyTotal,
              enrollmentFeeTotal: group.enrollmentFeeTotal,
              firstDueDate,
              effectiveAt,
              provisionAt: null,
              externalReference: `${externalReference}:unified-billing-agreement:${existingBillingAgreement.id}`,
              feeChargeMoment,
              feeUnit: groupKey === 'SHARED' ? configuredFeeUnit : 'PER_STUDENT',
              feePurpose: input.financialTerms?.feePurpose ?? 'ADMINISTRATIVE_FEE',
              snapshot: {
                unifiedIntoBillingAgreementId: existingBillingAgreement.id,
                unifiedIntoBillingAgreementVersion: existingBillingAgreement.version,
                contribution,
              } as Prisma.InputJsonValue,
            },
          });

          await tx.rematriculaAuditLog.create({
            data: {
              contaId: input.contaId,
              processoId: processo.id,
              actorId: input.actorId,
              action: 'FUTURE_AGREEMENT_UNIFIED',
              entityType: 'BillingAgreement',
              entityId: existingBillingAgreement.id,
              metadata: { proxyAgreementId: proxy.id, contribution, updatedDesiredValue } as Prisma.InputJsonValue,
            },
          });
          groupIndex += 1;
          continue;
        }

        if (existingAgreement) {
          const existingSnapshot = existingAgreement.snapshot && typeof existingAgreement.snapshot === 'object' && !Array.isArray(existingAgreement.snapshot)
            ? existingAgreement.snapshot as Record<string, unknown>
            : {};
          const contributions = Array.isArray(existingSnapshot.unifiedContributions)
            ? existingSnapshot.unifiedContributions
            : [];
          const contribution = {
            processId: processo.id,
            monthlyTotal: group.monthlyTotal,
            enrollmentFeeTotal: group.enrollmentFeeTotal,
            sourceEnrollmentIds: group.items.map((item) => item.sourceEnrollmentId),
          };
          const updatedMonthlyTotal = toMoney(Number(existingAgreement.monthlyTotal) + group.monthlyTotal);
          const updatedEnrollmentFeeTotal = toMoney(Number(existingAgreement.enrollmentFeeTotal) + group.enrollmentFeeTotal);

          await tx.acordoFinanceiroFuturo.update({
            where: { id: existingAgreement.id },
            data: {
              status: 'SCHEDULED',
              monthlyTotal: updatedMonthlyTotal,
              enrollmentFeeTotal: updatedEnrollmentFeeTotal,
              snapshot: {
                ...existingSnapshot,
                monthlyTotal: updatedMonthlyTotal,
                enrollmentFeeTotal: updatedEnrollmentFeeTotal,
                unifiedContributions: [...contributions, contribution],
              } as Prisma.InputJsonValue,
            },
          });

          const proxy = await tx.acordoFinanceiroFuturo.create({
            data: {
              contaId: input.contaId,
              processoId: processo.id,
              matriculaFuturaId: group.items.length === 1
                ? (await tx.rematriculaItem.findFirst({
                    where: { processoId: processo.id, matriculaOrigemId: group.items[0]!.sourceEnrollmentId },
                    select: { matriculaFuturaId: true },
                  }))?.matriculaFuturaId ?? null
                : null,
              responsavelId: input.holderType === 'RESPONSIBLE' ? input.holderId : null,
              status: 'ACTIVE',
              monthlyTotal: group.monthlyTotal,
              enrollmentFeeTotal: group.enrollmentFeeTotal,
              firstDueDate,
              effectiveAt,
              provisionAt: null,
              externalReference: `${externalReference}:unified-proxy:${existingAgreement.id}`,
              feeChargeMoment,
              feeUnit: groupKey === 'SHARED' ? configuredFeeUnit : 'PER_STUDENT',
              feePurpose: input.financialTerms?.feePurpose ?? 'ADMINISTRATIVE_FEE',
              snapshot: {
                unifiedIntoAgreementId: existingAgreement.id,
                unifiedIntoProcessId: existingAgreement.processoId,
                contribution,
              } as Prisma.InputJsonValue,
            },
          });

          if (feeChargeMoment === 'CHARGE_ON_CONFIRMATION' && group.enrollmentFeeTotal > 0) {
            await tx.rematriculaOutbox.create({
              data: {
                contaId: input.contaId,
                processoId: processo.id,
                eventType: 'CREATE_RENEWAL_FEE_CHARGE',
                dedupeKey: `renewal-fee:${proxy.id}`,
                payload: {
                  acordoFinanceiroFuturoId: existingAgreement.id,
                  processoId: processo.id,
                  amount: group.enrollmentFeeTotal,
                  externalReference: `${externalReference}:unified-fee:${existingAgreement.id}`,
                } as Prisma.InputJsonValue,
              },
            });
          }

          await tx.rematriculaAuditLog.create({
            data: {
              contaId: input.contaId,
              processoId: processo.id,
              actorId: input.actorId,
              action: 'FUTURE_AGREEMENT_UNIFIED',
              entityType: 'AcordoFinanceiroFuturo',
              entityId: existingAgreement.id,
              metadata: {
                proxyAgreementId: proxy.id,
                previousProcessId: existingAgreement.processoId,
                contribution,
                updatedMonthlyTotal,
                updatedEnrollmentFeeTotal,
              } as Prisma.InputJsonValue,
            },
          });
          groupIndex += 1;
          continue;
        }

        const agreementExternalReference = `${externalReference}:group:${groupIndex}`;
        const financeiro = await tx.acordoFinanceiroFuturo.create({
          data: {
            contaId: input.contaId,
            processoId: processo.id,
            matriculaFuturaId: group.items.length === 1
              ? (await tx.rematriculaItem.findFirst({
                  where: { processoId: processo.id, matriculaOrigemId: group.items[0]!.sourceEnrollmentId },
                  select: { matriculaFuturaId: true },
                }))?.matriculaFuturaId ?? null
              : null,
            responsavelId: input.holderType === 'RESPONSIBLE' ? input.holderId : null,
            status: 'SCHEDULED',
            monthlyTotal: group.monthlyTotal,
            enrollmentFeeTotal: group.enrollmentFeeTotal,
            firstDueDate,
            effectiveAt,
            provisionAt: new Date(effectiveAt.getTime() - 10 * 24 * 60 * 60 * 1000),
            externalReference: agreementExternalReference,
            feeChargeMoment,
            feeUnit: groupKey === 'SHARED' ? configuredFeeUnit : 'PER_STUDENT',
            feePurpose: input.financialTerms?.feePurpose ?? 'ADMINISTRATIVE_FEE',
            snapshot: {
              ...(preview.futureFinancialAgreement ?? {}),
              groupKey,
              sourceEnrollmentIds: group.items.map((item) => item.sourceEnrollmentId),
              monthlyTotal: group.monthlyTotal,
              enrollmentFeeTotal: group.enrollmentFeeTotal,
            } as Prisma.InputJsonValue,
          },
        });

        if (feeChargeMoment === 'CHARGE_ON_CONFIRMATION' && group.enrollmentFeeTotal > 0) {
          await tx.rematriculaOutbox.create({
            data: {
              contaId: input.contaId,
              processoId: processo.id,
              eventType: 'CREATE_RENEWAL_FEE_CHARGE',
              dedupeKey: `renewal-fee:${financeiro.id}`,
              payload: {
                acordoFinanceiroFuturoId: financeiro.id,
                processoId: processo.id,
                amount: group.enrollmentFeeTotal,
                externalReference: `${agreementExternalReference}:fee`,
              } as Prisma.InputJsonValue,
            },
          });
        }
        groupIndex += 1;
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
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const concurrent = await deps.prisma.rematriculaProcesso.findFirst({
        where: { contaId: input.contaId, idempotencyKey },
      });
      if (concurrent && concurrent.status !== 'CANCELLED') {
        return {
          processId: concurrent.id,
          status: concurrent.status,
          previewHash: concurrent.previewHash,
          renewCount: concurrent.renewCount,
          pendingCount: concurrent.pendingCount,
          nonRenewalCount: concurrent.nonRenewalCount,
          idempotent: true,
        };
      }
    }
    throw error;
  }
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

    for (const financeiro of processo.financeiros) {
      const snapshot = financeiro.snapshot && typeof financeiro.snapshot === 'object' && !Array.isArray(financeiro.snapshot)
        ? financeiro.snapshot as Record<string, unknown>
        : null;
      const unifiedIntoAgreementId = snapshot && typeof snapshot.unifiedIntoAgreementId === 'string'
        ? snapshot.unifiedIntoAgreementId
        : null;
      const contribution = snapshot && snapshot.contribution && typeof snapshot.contribution === 'object' && !Array.isArray(snapshot.contribution)
        ? snapshot.contribution as Record<string, unknown>
        : null;
      const unifiedIntoBillingAgreementId = snapshot && typeof snapshot.unifiedIntoBillingAgreementId === 'string'
        ? snapshot.unifiedIntoBillingAgreementId
        : null;
      if (unifiedIntoBillingAgreementId && contribution) {
        const monthlyContribution = toMoney(contribution.monthlyTotal);
        const billingAgreement = await tx.billingAgreement.findFirst({
          where: { id: unifiedIntoBillingAgreementId, contaId: input.contaId, status: 'PENDING_PROVISION', asaasSubscriptionId: null },
          select: { id: true, desiredValue: true },
        });
        if (billingAgreement) {
          await tx.billingAllocation.updateMany({
            where: {
              contaId: input.contaId,
              agreementId: billingAgreement.id,
              matriculaId: { in: futureIds },
              status: { in: ['SCHEDULED', 'ACTIVE'] },
            },
            data: { status: 'CANCELLED' },
          });
          await tx.billingAgreement.update({
            where: { id: billingAgreement.id },
            data: { desiredValue: toMoney(Number(billingAgreement.desiredValue) - monthlyContribution), version: { increment: 1 } },
          });
          await tx.rematriculaAuditLog.create({
            data: {
              contaId: input.contaId,
              processoId: processo.id,
              actorId: input.actorId,
              action: 'FUTURE_AGREEMENT_UNIFICATION_REVERTED',
              entityType: 'BillingAgreement',
              entityId: billingAgreement.id,
              metadata: { monthlyContribution } as Prisma.InputJsonValue,
            },
          });
        }
        continue;
      }
      if (!unifiedIntoAgreementId || !contribution) continue;

      const monthlyContribution = toMoney(contribution.monthlyTotal);
      const feeContribution = toMoney(contribution.enrollmentFeeTotal);
      const unifiedAgreement = await tx.acordoFinanceiroFuturo.findFirst({
        where: { id: unifiedIntoAgreementId, contaId: input.contaId },
        select: { id: true, monthlyTotal: true, enrollmentFeeTotal: true, snapshot: true },
      });
      if (!unifiedAgreement) continue;

      const unifiedSnapshot = unifiedAgreement.snapshot && typeof unifiedAgreement.snapshot === 'object' && !Array.isArray(unifiedAgreement.snapshot)
        ? unifiedAgreement.snapshot as Record<string, unknown>
        : {};
      const existingContributions = Array.isArray(unifiedSnapshot.unifiedContributions)
        ? unifiedSnapshot.unifiedContributions.filter((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
            return (entry as Record<string, unknown>).processId !== input.processId;
          })
        : [];
      await tx.acordoFinanceiroFuturo.update({
        where: { id: unifiedAgreement.id },
        data: {
          monthlyTotal: toMoney(Number(unifiedAgreement.monthlyTotal) - monthlyContribution),
          enrollmentFeeTotal: toMoney(Number(unifiedAgreement.enrollmentFeeTotal) - feeContribution),
          snapshot: {
            ...unifiedSnapshot,
            monthlyTotal: toMoney(Number(unifiedAgreement.monthlyTotal) - monthlyContribution),
            enrollmentFeeTotal: toMoney(Number(unifiedAgreement.enrollmentFeeTotal) - feeContribution),
            unifiedContributions: existingContributions,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.rematriculaOutbox.deleteMany({
        where: { contaId: input.contaId, processoId: processo.id, dedupeKey: `renewal-fee:${financeiro.id}` },
      });
      await tx.rematriculaAuditLog.create({
        data: {
          contaId: input.contaId,
          processoId: processo.id,
          actorId: input.actorId,
          action: 'FUTURE_AGREEMENT_UNIFICATION_REVERTED',
          entityType: 'AcordoFinanceiroFuturo',
          entityId: unifiedAgreement.id,
          metadata: { monthlyContribution, feeContribution } as Prisma.InputJsonValue,
        },
      });
    }

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
      status: { in: ['CONFIRMED', 'WAITING_FOR_START', 'REQUIRES_ATTENTION'] },
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
        include: {
          itens: true,
          reservas: true,
          financeiros: true,
          contratos: true,
          pendencias: {
            where: { status: 'OPEN', severity: 'BLOCKER' },
            select: { id: true, code: true },
          },
        },
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
      const renewedItems = full.itens.filter((item) => item.decision === 'RENEW');
      const contractRequired = full.contratos.length > 0;
      const contractStatus = full.contratos.some((contract) =>
        contract.status !== 'SIGNED_SCHEDULED' && contract.status !== 'ACTIVE',
      )
        ? (full.contratos.find((contract) =>
            contract.status !== 'SIGNED_SCHEDULED' && contract.status !== 'ACTIVE',
          )?.status ?? null)
        : full.contratos[0]?.status ?? null;
      const financeRequired = renewedItems.length > 0;
      const financeStatus = full.financeiros.some((financeiro) => financeiro.status === 'FAILED')
        ? 'FAILED'
        : full.financeiros.length > 0 && full.financeiros.every((financeiro) => financeiro.status === 'ACTIVE')
          ? 'ACTIVE'
          : full.financeiros[0]?.status ?? null;
      const activation = evaluateRenewalActivation({
        now,
        effectiveAt: full.effectiveAt,
        sourceOverlapsEffectiveAt: hasOverlap,
        hasFutureEnrollment: renewedItems.every((item) => Boolean(item.matriculaFuturaId)),
        hasReservation: !hasMissingReservation,
        contractRequired,
        contractStatus,
        financeRequired,
        financeStatus,
        hasOpenBlockingPending: full.pendencias.some(
          (pending) => pending.code !== 'FUTURE_CYCLE_ACTIVATION_BLOCKED',
        ),
      });

      if (!activation.eligible) {
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
              blockers: activation.blockers,
              contractStatus,
              financeStatus,
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
              blockers: activation.blockers,
              contractStatus,
              financeStatus,
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
        data: {
          status: 'ATIVA',
          ...(contractRequired ? { statusContrato: 'ATIVO' } : {}),
        },
      });
      await tx.reservaVagaFutura.updateMany({
        where: { contaId: input.contaId, processoId: full.id, status: 'RESERVED' },
        data: { status: 'CONVERTED', convertedAt: now },
      });
      await tx.contratoFuturo.updateMany({
        where: { contaId: input.contaId, processoId: full.id, status: 'SIGNED_SCHEDULED' },
        data: { status: 'ACTIVE' },
      });

      await tx.rematriculaPendencia.updateMany({
        where: {
          contaId: input.contaId,
          processoId: full.id,
          code: 'FUTURE_CYCLE_ACTIVATION_BLOCKED',
          status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
        data: {
          status: 'RESOLVED',
          resolution: 'Pré-requisitos atendidos em nova avaliação automática.',
          resolvedAt: now,
        },
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
