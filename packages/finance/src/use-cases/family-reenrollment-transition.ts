import { randomUUID, createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  buildFamilyReenrollmentTransitionPlan,
  hashFamilyReenrollmentPreview,
  type FamilyReenrollmentDecision,
  type FamilyReenrollmentTransitionPlan,
} from '@alusa/domain';

type PaymentMethod = 'BOLETO' | 'PIX' | 'CARTAO_CREDITO';

export type FamilyReenrollmentStudentDecisionInput = {
  matriculaId: string;
  decision: FamilyReenrollmentDecision;
  turmaId?: string | null;
  planoId?: string | null;
  comboId?: string | null;
  decisionReason?: string | null;
};

export type FamilyReenrollmentTransitionInput = {
  contaId: string;
  responsavelId: string;
  actorId: string;
  dataInicio: Date;
  dataFimContrato: Date;
  formaPagamento: PaymentMethod;
  formaPagamentoTaxa?: PaymentMethod;
  vencimentoDia: number;
  taxaMatricula?: number;
  taxaIsenta?: boolean;
  taxaJustificativa?: string | null;
  descontos?: Array<{ id: string; cumulativo?: boolean }>;
  multaPercentual?: number;
  jurosMensal?: number;
  descontoAntecipado?: number;
  prazoDesconto?: number;
  overrideReason?: string | null;
  notificationChannels?: Array<'EMAIL' | 'SMS' | 'WHATSAPP'>;
  notificationChannelsConfigured?: boolean;
  contratoModeloId?: string | null;
  uiRequestId?: string | null;
  students: FamilyReenrollmentStudentDecisionInput[];
};

export type PersistFamilyReenrollmentPreviewInput = FamilyReenrollmentTransitionInput;

export type CommitFamilyReenrollmentInput = FamilyReenrollmentTransitionInput & {
  previewId?: string | null;
  previewHash?: string | null;
};

export type FamilyReenrollmentCommitResult = {
  transitionId: string;
  status: string;
  step: string;
  academicStatus: string;
  sourceBillingStatus: string;
  targetBillingStatus: string;
  contractStatus: string;
  previewHash: string;
  warnings: string[];
  results: Array<{
    matriculaId: string;
    alunoId: string;
    alunoNome: string;
    decision: FamilyReenrollmentDecision;
    status: 'success' | 'pending' | 'error';
    novaMatriculaId?: string | null;
    errorMessage?: string | null;
  }>;
  outboxEventIds: string[];
};

type Deps = {
  prisma: PrismaClient;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function mapPaymentMethodToBillingType(method: PaymentMethod) {
  if (method === 'CARTAO_CREDITO') return 'CREDIT_CARD';
  return method;
}

function mapCycle(periodicidade?: string | null) {
  switch (periodicidade) {
    case 'SEMANAL':
      return 'WEEKLY';
    case 'QUINZENAL':
      return 'BIWEEKLY';
    case 'TRIMESTRAL':
      return 'QUARTERLY';
    case 'ANUAL':
      return 'YEARLY';
    default:
      return 'MONTHLY';
  }
}

function firstDueDate(dataInicio: Date, dueDay: number) {
  const day = Math.min(28, Math.max(1, dueDay));
  const due = new Date(dataInicio.getFullYear(), dataInicio.getMonth(), day);
  if (due <= dataInicio) return new Date(dataInicio.getFullYear(), dataInicio.getMonth() + 1, day);
  return due;
}

function enrollmentFeeDueDate(dataInicio: Date) {
  return new Date(dataInicio.getFullYear(), dataInicio.getMonth(), dataInicio.getDate());
}

function sourceVersionFromRows(rows: Array<{ id: string; updatedAt: Date }>) {
  return createHash('sha256')
    .update(rows.map((row) => `${row.id}:${row.updatedAt.toISOString()}`).sort().join('|'))
    .digest('hex');
}

function buildOperationalSnapshot(input: FamilyReenrollmentTransitionInput) {
  return {
    contractModelId: input.contratoModeloId ?? null,
    enrollmentFee: {
      value: input.taxaIsenta === true ? 0 : money(input.taxaMatricula),
      exempt: input.taxaIsenta === true,
      exemptionReason: input.taxaJustificativa ?? null,
      paymentMethod: input.formaPagamentoTaxa ?? input.formaPagamento,
    },
    billingTerms: {
      paymentMethod: input.formaPagamento,
      dueDay: input.vencimentoDia,
      startDate: isoDate(input.dataInicio),
      endDate: isoDate(input.dataFimContrato),
      finePercentage: input.multaPercentual ?? null,
      monthlyInterest: input.jurosMensal ?? null,
      earlyPaymentDiscount: input.descontoAntecipado ?? null,
      discountDeadlineDays: input.prazoDesconto ?? null,
      selectedDiscounts: (input.descontos ?? []).map((discount) => ({
        id: discount.id,
        cumulativo: discount.cumulativo === true,
      })),
    },
    notificationChannels: input.notificationChannels ?? [],
    notificationChannelsConfigured: input.notificationChannelsConfigured === true,
    overrideReason: input.overrideReason ?? null,
  };
}

async function resolveDiscounts(
  prisma: PrismaClient,
  contaId: string,
  discounts: Array<{ id: string; cumulativo?: boolean }> | undefined,
) {
  if (!discounts?.length) return [];
  const ids = Array.from(new Set(discounts.map((item) => item.id).filter(Boolean)));
  const records = await prisma.desconto.findMany({
    where: { contaId, id: { in: ids }, status: 'ATIVO' },
    select: { id: true, tipo: true, valor: true },
  });

  return records.map((record) => ({
    id: record.id,
    tipo: record.tipo,
    valor: money(record.valor),
    cumulativo: discounts.find((item) => item.id === record.id)?.cumulativo === true,
  }));
}

function applyDiscounts(baseValue: number, discounts: Awaited<ReturnType<typeof resolveDiscounts>>) {
  const values = discounts.map((discount) =>
    discount.tipo === 'PERCENTUAL'
      ? money(baseValue * (discount.valor / 100))
      : money(discount.valor),
  );
  const applied = discounts.some((discount) => discount.cumulativo)
    ? values
    : values.length
      ? [Math.max(...values)]
      : [];
  const discountAmount = money(applied.reduce((sum, item) => sum + item, 0));
  return {
    amount: Math.max(0, money(baseValue - discountAmount)),
    discountAmount,
  };
}

async function buildPlan(
  input: FamilyReenrollmentTransitionInput,
  deps: Deps,
): Promise<FamilyReenrollmentTransitionPlan> {
  const { prisma } = deps;
  const sourceIds = input.students.map((item) => item.matriculaId);
  const sourceRows = await prisma.matricula.findMany({
    where: { id: { in: sourceIds }, aluno: { contaId: input.contaId } },
    include: {
      aluno: { select: { id: true, nome: true } },
      plano: { select: { id: true, valor: true, periodicidade: true } },
      combo: { select: { id: true, valor: true, periodicidade: true } },
      matriculaFamiliar: { select: { id: true, updatedAt: true } },
    },
  });

  if (sourceRows.length !== sourceIds.length) {
    throw new Error('Uma ou mais matrículas familiares não pertencem a esta conta.');
  }

  const byId = new Map(sourceRows.map((row) => [row.id, row]));
  const familyIds = Array.from(
    new Set(sourceRows.map((row) => row.matriculaFamiliarId).filter(Boolean) as string[]),
  );

  if (familyIds.length > 1) {
    throw new Error('A rematrícula familiar deve partir de uma única composição familiar.');
  }

  if (familyIds[0]) {
    const familyItems = await prisma.matriculaFamiliarItem.findMany({
      where: { matriculaFamiliarId: familyIds[0] },
      select: { matriculaId: true },
    });
    const decided = new Set(sourceIds);
    const missing = familyItems.filter((item) => !decided.has(item.matriculaId));
    if (missing.length > 0) {
      throw new Error('Todos os alunos da composição familiar precisam de uma decisão explícita.');
    }
  }

  const discounts = await resolveDiscounts(deps.prisma, input.contaId, input.descontos);
  const sourceVersion = sourceVersionFromRows(sourceRows);
  const sourceFamilyEnrollmentId = familyIds[0] ?? null;
  const sourceFinancialAgreement = sourceFamilyEnrollmentId
    ? await prisma.standaloneSubscription.findFirst({
        where: {
          contaId: input.contaId,
          familyGroupId: sourceFamilyEnrollmentId,
          status: { in: ['REQUESTED', 'ACTIVE'] },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          asaasSubscriptionId: true,
          status: true,
          value: true,
          endDate: true,
          familyGroupId: true,
        },
      })
    : null;

  const students = input.students.map((item) => {
    const source = byId.get(item.matriculaId)!;
    const targetPlan = item.planoId
      ? null
      : source.plano;
    const targetCombo = item.comboId
      ? null
      : source.combo;
    const baseValue =
      item.decision === 'REMATRICULAR_AGORA'
        ? money(
            item.comboId
              ? 0
              : item.planoId
                ? 0
                : targetCombo?.valor ?? targetPlan?.valor ?? 0,
          )
        : 0;

    return {
      sourceEnrollmentId: item.matriculaId,
      alunoId: source.aluno.id,
      alunoNome: source.aluno.nome,
      decision: item.decision,
      targetClassId: item.turmaId ?? source.turmaId ?? null,
      targetPlanId: item.planoId ?? source.planoId ?? null,
      targetComboId: item.comboId ?? source.comboId ?? null,
      payerId: input.responsavelId,
      customerId: null,
      paymentMethod: input.formaPagamento,
      dueDay: input.vencimentoDia,
      cycle: mapCycle(targetCombo?.periodicidade ?? targetPlan?.periodicidade),
      startDate: isoDate(input.dataInicio),
      endDate: isoDate(input.dataFimContrato),
      amount: baseValue,
      baseAmount: baseValue,
      discountAmount: applyDiscounts(baseValue, discounts).discountAmount,
      sourceUpdatedAt: source.updatedAt.toISOString(),
      blockReason: null,
    };
  });

  for (const item of students) {
    if (item.decision !== 'REMATRICULAR_AGORA') continue;
    if (item.targetPlanId || item.targetComboId) {
      const product =
        item.targetComboId
          ? await prisma.combo.findFirst({
              where: { id: item.targetComboId, contaId: input.contaId, status: 'ATIVO' },
              select: { valor: true, periodicidade: true },
            })
          : await prisma.plano.findFirst({
              where: { id: item.targetPlanId ?? '', contaId: input.contaId, status: 'ATIVO' },
              select: { valor: true, periodicidade: true },
            });
      const baseValue = money(product?.valor);
      const calculated = applyDiscounts(baseValue, discounts);
      item.baseAmount = baseValue;
      item.amount = calculated.amount;
      item.discountAmount = calculated.discountAmount;
      item.cycle = mapCycle(product?.periodicidade);
    }
  }

  const plan = buildFamilyReenrollmentTransitionPlan({
    contaId: input.contaId,
    responsavelId: input.responsavelId,
    effectiveDate: isoDate(input.dataInicio),
    sourceVersion,
    sourceBilling: {
      sourceFamilyEnrollmentId,
      sourceFinancialAgreementId: sourceFinancialAgreement?.id ?? null,
      familyGroupId: sourceFinancialAgreement?.familyGroupId ?? sourceFamilyEnrollmentId,
      currentSubscriptionId: sourceFinancialAgreement?.asaasSubscriptionId ?? null,
      currentSubscriptionStatus: sourceFinancialAgreement?.status ?? null,
      validUntil: sourceFinancialAgreement?.endDate?.toISOString() ?? null,
      totalAmount: sourceFinancialAgreement ? money(sourceFinancialAgreement.value) : null,
    },
    students,
  });

  const snapshot = {
    ...plan.snapshot,
    operational: buildOperationalSnapshot(input),
  };

  return {
    ...plan,
    snapshot,
    previewHash: hashFamilyReenrollmentPreview(snapshot),
  };
}

export async function persistFamilyReenrollmentPreview(
  input: PersistFamilyReenrollmentPreviewInput,
  deps: Deps,
) {
  const plan = await buildPlan(input, deps);
  const uiRequestId = input.uiRequestId ?? `preview:${plan.previewHash}`;
  const existing = await deps.prisma.rematriculaFamiliar.findFirst({
    where: { contaId: input.contaId, uiRequestId },
    select: { id: true },
  });

  const transition = existing
    ? await deps.prisma.rematriculaFamiliar.update({
        where: { id: existing.id },
        data: {
          previewSnapshot: plan.snapshot as Prisma.InputJsonValue,
          previewHash: plan.previewHash,
          sourceVersion: plan.sourceVersion,
          sourceFamilyEnrollmentId: plan.sourceBilling?.sourceFamilyEnrollmentId ?? null,
          sourceFinancialAgreementId: plan.sourceBilling?.sourceFinancialAgreementId ?? null,
          effectiveAt: input.dataInicio,
          step: 'PREVIEW_PERSISTED',
          sourceBillingStatus: plan.sourceBillingAction,
          targetBillingStatus: 'NOT_REQUESTED',
          contractStatus: 'PENDING',
          status: 'PENDENTE',
          ultimoErro: plan.blocks[0]?.message ?? null,
        },
        select: { id: true },
      })
    : await deps.prisma.rematriculaFamiliar.create({
        data: {
      contaId: input.contaId,
      responsavelId: input.responsavelId,
      sourceFamilyEnrollmentId: plan.sourceBilling?.sourceFamilyEnrollmentId ?? null,
      sourceFinancialAgreementId: plan.sourceBilling?.sourceFinancialAgreementId ?? null,
      billingMode: 'SHARED_PLAN',
      status: 'PENDENTE',
      step: 'PREVIEW_PERSISTED',
      effectiveAt: input.dataInicio,
      previewSnapshot: plan.snapshot as Prisma.InputJsonValue,
      previewHash: plan.previewHash,
      sourceVersion: plan.sourceVersion,
      sourceBillingStatus: plan.sourceBillingAction,
      targetBillingStatus: 'NOT_REQUESTED',
      contractStatus: 'PENDING',
      totalAlunos: plan.reenrollNow.length,
      valorMensalidadeTotal: plan.financialGroups.reduce((sum, group) => sum + group.totalAmount, 0),
      valorTaxaMatriculaTotal:
        input.taxaIsenta === true ? 0 : money(input.taxaMatricula) * plan.reenrollNow.length,
      formaPagamento: input.formaPagamento,
      ciclo: plan.financialGroups[0]?.cycle ?? null,
      diaVencimento: input.vencimentoDia,
      dataInicio: input.dataInicio,
      dataFimContrato: input.dataFimContrato,
      actorId: input.actorId,
      uiRequestId,
      ultimoErro: plan.blocks[0]?.message ?? null,
    },
        select: { id: true },
      });

  return { previewId: transition.id, plan };
}

async function createOutboxEvent(params: {
  prisma: PrismaClient | Prisma.TransactionClient;
  contaId: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}) {
  const dedupeKey = `REMATRICULA_FAMILIAR:${params.aggregateId}:${params.eventType}:v1`;
  const existing = await params.prisma.familyBillingOutbox.findFirst({
    where: { contaId: params.contaId, dedupeKey },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await params.prisma.familyBillingOutbox.create({
    data: {
      contaId: params.contaId,
      aggregateType: 'REMATRICULA_FAMILIAR',
      aggregateId: params.aggregateId,
      eventType: params.eventType,
      dedupeKey,
      rematriculaFamiliarId: params.aggregateId,
      payload: params.payload,
    },
    select: { id: true },
  });
  return created.id;
}

export async function commitFamilyReenrollmentTransition(
  input: CommitFamilyReenrollmentInput,
  deps: Deps,
): Promise<FamilyReenrollmentCommitResult> {
  const { previewId, plan } = await persistFamilyReenrollmentPreview(input, deps);

  if (input.previewHash && input.previewHash !== plan.previewHash) {
    throw new Error('TRANSICAO_DESATUALIZADA');
  }
  if (plan.blocks.length > 0) {
    throw new Error(plan.blocks[0]?.message ?? 'Preview possui bloqueios.');
  }

  const sourceRows = await deps.prisma.matricula.findMany({
    where: {
      id: { in: input.students.map((item) => item.matriculaId) },
      aluno: { contaId: input.contaId },
    },
    include: {
      aluno: { select: { id: true, nome: true } },
    },
  });
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));

  const correlationId = randomUUID();
  const outboxEventIds: string[] = [];
  const results: FamilyReenrollmentCommitResult['results'] = [];
  const monthlyTotal = plan.financialGroups.reduce((sum, group) => sum + group.totalAmount, 0);
  const enrollmentFeeValue =
    input.taxaIsenta === true ? 0 : money(input.taxaMatricula) * plan.reenrollNow.length;

  await deps.prisma.$transaction(async (tx) => {
    await tx.rematriculaFamiliar.update({
      where: { id: previewId },
      data: {
        status: 'PROCESSANDO',
        step: 'MATRICULAS_PREPARADAS',
        correlationId,
        committedAt: new Date(),
        sourceBillingStatus:
          plan.sourceBillingAction === 'SCHEDULE_CLOSURE'
            ? 'CLOSURE_REQUESTED'
            : plan.sourceBillingAction,
        targetBillingStatus: monthlyTotal > 0 ? 'AWAITING_PROVIDER_REQUEST' : 'NOT_APPLICABLE',
        contractStatus: input.contratoModeloId ? 'PENDING' : 'NOT_SELECTED',
        totalAlunos: plan.reenrollNow.length,
        valorMensalidadeTotal: monthlyTotal,
        valorTaxaMatriculaTotal: enrollmentFeeValue,
        formaPagamento: input.formaPagamento,
        ciclo: plan.financialGroups[0]?.cycle ?? null,
        diaVencimento: input.vencimentoDia,
        dataInicio: input.dataInicio,
        dataFimContrato: input.dataFimContrato,
      },
    });

    if (plan.sourceBilling?.sourceFinancialAgreementId) {
      await tx.standaloneSubscription.updateMany({
        where: {
          id: plan.sourceBilling.sourceFinancialAgreementId,
          contaId: input.contaId,
        },
        data: {
          validUntil: input.dataInicio,
          closureScheduledAt: new Date(),
          familyTransitionId: previewId,
        },
      });
    }

    for (const [index, decision] of input.students.entries()) {
      const source = sourceById.get(decision.matriculaId);
      if (!source) continue;
      const planStudent =
        plan.reenrollNow.find((item) => item.sourceEnrollmentId === decision.matriculaId) ??
        plan.notContinuing.find((item) => item.sourceEnrollmentId === decision.matriculaId) ??
        plan.decideLater.find((item) => item.sourceEnrollmentId === decision.matriculaId) ??
        plan.separated.find((item) => item.sourceEnrollmentId === decision.matriculaId);

      let targetMatriculaId: string | null = null;
      if (decision.decision === 'REMATRICULAR_AGORA') {
        const target = await tx.matricula.create({
          data: {
            contaId: input.contaId,
            alunoId: source.alunoId,
            responsavelFinanceiroId: input.responsavelId,
            turmaId: decision.turmaId ?? source.turmaId ?? null,
            planoId: decision.planoId ?? source.planoId ?? null,
            comboId: decision.comboId ?? source.comboId ?? null,
            billingMode: 'SHARED_PLAN',
            rematriculadaDeId: source.id,
            dataInicio: input.dataInicio,
            dataFimContrato: input.dataFimContrato,
            status: 'AGUARDANDO_CONFIRMACAO',
            statusFinanceiro: 'PENDENTE_FINANCEIRO',
            statusContrato: 'AGUARDANDO_ASSINATURA',
            taxaMatricula: input.taxaIsenta ? 0 : money(input.taxaMatricula),
            taxaIsenta: input.taxaIsenta === true,
            taxaStatus: input.taxaIsenta ? 'ISENTO' : money(input.taxaMatricula) > 0 ? 'PENDENTE' : 'ISENTO',
            taxaJustificativa: input.taxaJustificativa ?? null,
            formaPagamento: input.formaPagamento,
            formaPagamentoTaxa: input.formaPagamentoTaxa ?? input.formaPagamento,
            vencimentoDia: input.vencimentoDia,
            jurosMensal: input.jurosMensal,
            multaPercentual: input.multaPercentual,
            descontoAntecipado: input.descontoAntecipado,
            prazoDesconto: input.prazoDesconto,
          },
          select: { id: true },
        });
        targetMatriculaId = target.id;
      }

      const item = await tx.rematriculaFamiliarItem.upsert({
        where: {
          uq_rematricula_familiar_item: {
            rematriculaFamiliarId: previewId,
            matriculaOrigemId: source.id,
          },
        },
        update: {
          novaMatriculaId: targetMatriculaId,
          decision: decision.decision,
          decisionReason: decision.decisionReason ?? null,
          academicStatus:
            decision.decision === 'REMATRICULAR_AGORA' ? 'PREPARED' : 'NO_TARGET_ENROLLMENT',
          contractStatus:
            decision.decision === 'REMATRICULAR_AGORA' && input.contratoModeloId
              ? 'PENDING'
              : 'NOT_APPLICABLE',
          amount: planStudent?.amount ?? null,
          validFrom: input.dataInicio,
          validUntil: input.dataFimContrato,
          status: decision.decision === 'REMATRICULAR_AGORA' ? 'PREPARADO' : 'DECISAO_REGISTRADA',
          erro: null,
        },
        create: {
          rematriculaFamiliarId: previewId,
          matriculaOrigemId: source.id,
          novaMatriculaId: targetMatriculaId,
          orderIndex: index,
          decision: decision.decision,
          decisionReason: decision.decisionReason ?? null,
          academicStatus:
            decision.decision === 'REMATRICULAR_AGORA' ? 'PREPARED' : 'NO_TARGET_ENROLLMENT',
          contractStatus:
            decision.decision === 'REMATRICULAR_AGORA' && input.contratoModeloId
              ? 'PENDING'
              : 'NOT_APPLICABLE',
          amount: planStudent?.amount ?? null,
          validFrom: input.dataInicio,
          validUntil: input.dataFimContrato,
          status: decision.decision === 'REMATRICULAR_AGORA' ? 'PREPARADO' : 'DECISAO_REGISTRADA',
        },
        select: { id: true },
      });

      if (targetMatriculaId && planStudent) {
        const allocation = await tx.familyFinancialAllocation.create({
          data: {
            contaId: input.contaId,
            alunoId: source.alunoId,
            matriculaId: targetMatriculaId,
            sourceMatriculaId: source.id,
            rematriculaFamiliarId: previewId,
            rematriculaFamiliarItemId: item.id,
            familyGroupId: previewId,
            chargeKind: 'MENSALIDADE',
            status: 'PENDING',
            amount: planStudent.amount,
            baseAmount: planStudent.baseAmount ?? planStudent.amount,
            discountAmount: planStudent.discountAmount ?? 0,
            competenceStart: input.dataInicio,
            competenceEnd: input.dataFimContrato,
            sourceAgreementId: plan.sourceBilling?.sourceFinancialAgreementId ?? null,
            metadata: {
              decision: decision.decision,
              sourceVersion: plan.sourceVersion,
            },
          },
          select: { id: true },
        });
        await tx.rematriculaFamiliarItem.update({
          where: { id: item.id },
          data: { targetAllocationId: allocation.id },
        });
      }

      results.push({
        matriculaId: source.id,
        alunoId: source.alunoId,
        alunoNome: source.aluno.nome,
        decision: decision.decision,
        status: decision.decision === 'REMATRICULAR_AGORA' ? 'pending' : 'success',
        novaMatriculaId: targetMatriculaId,
      });
    }

    if (plan.sourceBilling?.sourceFinancialAgreementId) {
      outboxEventIds.push(
        await createOutboxEvent({
          prisma: tx,
          contaId: input.contaId,
          aggregateId: previewId,
          eventType: 'REQUEST_SOURCE_SUBSCRIPTION_CLOSURE',
          payload: {
            aggregateType: 'REMATRICULA_FAMILIAR',
            aggregateId: previewId,
            contaId: input.contaId,
            sourceFinancialAgreementId: plan.sourceBilling.sourceFinancialAgreementId,
            sourceAsaasSubscriptionId: plan.sourceBilling.currentSubscriptionId,
            effectiveDate: isoDate(input.dataInicio),
            actorId: input.actorId,
            correlationId,
          } as Prisma.InputJsonValue,
        }),
      );
    }

    if (monthlyTotal > 0 || enrollmentFeeValue > 0) {
      outboxEventIds.push(
        await createOutboxEvent({
          prisma: tx,
          contaId: input.contaId,
          aggregateId: previewId,
          eventType: 'CREATE_TARGET_FAMILY_BILLING',
          payload: {
            aggregateType: 'REMATRICULA_FAMILIAR',
            aggregateId: previewId,
            contaId: input.contaId,
            responsavelId: input.responsavelId,
            responsavelNome: 'Responsável',
            totalAlunos: plan.reenrollNow.length,
            monthlyValue: monthlyTotal,
            enrollmentFeeValue,
            billingType: mapPaymentMethodToBillingType(input.formaPagamento),
            enrollmentFeeBillingType: mapPaymentMethodToBillingType(
              input.formaPagamentoTaxa ?? input.formaPagamento,
            ),
            cycle: plan.financialGroups[0]?.cycle ?? 'MONTHLY',
            nextDueDate: isoDate(firstDueDate(input.dataInicio, input.vencimentoDia)),
            endDate: isoDate(input.dataFimContrato),
            enrollmentFeeDueDate: isoDate(enrollmentFeeDueDate(input.dataInicio)),
            description: `Rematrícula familiar · ${plan.reenrollNow.length} aluno(s)`,
            actorId: input.actorId,
            uiRequestId: input.uiRequestId ?? previewId,
            notificationChannels: input.notificationChannels ?? [],
            notificationChannelsConfigured: input.notificationChannelsConfigured === true,
            discount:
              input.descontoAntecipado && input.descontoAntecipado > 0
                ? {
                    value: input.descontoAntecipado,
                    type: 'PERCENTAGE',
                    dueDateLimitDays: input.prazoDesconto ?? 0,
                  }
                : null,
            interest: input.jurosMensal && input.jurosMensal > 0 ? { value: input.jurosMensal } : null,
            fine:
              input.multaPercentual && input.multaPercentual > 0
                ? { value: input.multaPercentual, type: 'PERCENTAGE' }
                : null,
          } as Prisma.InputJsonValue,
        }),
      );
    }
  });

  return {
    transitionId: previewId,
    status: 'PROCESSANDO',
    step: 'MATRICULAS_PREPARADAS',
    academicStatus: 'PREPARED',
    sourceBillingStatus:
      plan.sourceBillingAction === 'SCHEDULE_CLOSURE' ? 'CLOSURE_REQUESTED' : plan.sourceBillingAction,
    targetBillingStatus: monthlyTotal > 0 ? 'AWAITING_PROVIDER_REQUEST' : 'NOT_APPLICABLE',
    contractStatus: input.contratoModeloId ? 'PENDING' : 'NOT_SELECTED',
    previewHash: plan.previewHash,
    warnings: plan.warnings,
    results,
    outboxEventIds,
  };
}
