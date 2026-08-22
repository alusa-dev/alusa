import { Prisma, type PrismaClient } from '@prisma/client';
import { buildSeatOccupancyOverlapWhereClause } from '@alusa/lib';
import { listarRematriculasElegiveis } from './rematricula.service';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type RenewalCampaignClassOverview = {
  turmaId: string;
  turmaNome: string;
  capacidade: number;
  ocupadas: number;
  reservasAtivas: number;
  confirmados: number;
  pendentes: number;
  vagasDisponiveis: number;
  percentualOcupacao: number;
  statusCapacidade: 'DISPONIVEL' | 'PROXIMA_DO_LIMITE' | 'LOTADA' | 'EXCEDIDA';
  alunos: Array<{
    processoId: string;
    itemId: string;
    alunoId: string;
    alunoNome: string;
    alunoFoto: string | null;
    processoStatus: string;
    itemStatus: string;
    reservaStatus: string | null;
  }>;
};

export type RenewalCampaignOverview = {
  campaignId: string;
  targetPeriodId: string;
  totalTurmas: number;
  totalAlunos: number;
  totalConfirmados: number;
  totalPendentes: number;
  totalOcupadas: number;
  totalCapacidade: number;
  totalVagasDisponiveis: number;
  inconsistenciasSemTurma: number;
  turmas: RenewalCampaignClassOverview[];
};

export type CreateRenewalCampaignInput = {
  contaId: string;
  actorId: string;
  nome: string;
  descricao?: string | null;
  targetPeriodId: string;
  campaignStartsAt: Date;
  campaignEndsAt?: Date | null;
  audienceDefinition?: Record<string, unknown> | null;
  status?: 'DRAFT' | 'SCHEDULED' | 'ACTIVE';
};

export type UpdateRenewalCampaignInput = Partial<
  Pick<
    CreateRenewalCampaignInput,
    'nome' | 'descricao' | 'targetPeriodId' | 'campaignStartsAt' | 'campaignEndsAt' | 'audienceDefinition'
  >
> & {
  contaId: string;
  actorId: string;
  campaignId: string;
  status?: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
};

export type DeleteRenewalCampaignResult = {
  deleted: true;
  mode: 'HARD_DELETE' | 'SOFT_DELETE';
  campaignId: string;
};

function toIso(date?: Date | null) {
  return date ? date.toISOString() : null;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readDiasAntecedencia(rules: unknown) {
  if (!rules || typeof rules !== 'object') return 180;
  const value = (rules as { diasAntecedencia?: unknown }).diasAntecedencia;
  const parsed = Number(value ?? 180);
  return Number.isFinite(parsed) ? Math.min(365, Math.max(1, Math.trunc(parsed))) : 180;
}

function buildCanonicalCampaignRules(): Prisma.InputJsonObject {
  return {
    policy: 'ALUSA_CANONICAL_RENEWAL_FLOW',
    version: 1,
    campaignPurpose: 'ORGANIZATION_AND_METRICS',
    currentCycleBehavior: 'PRESERVE_CURRENT_CONTRACT_AND_BILLING',
    futureCycleBehavior: 'START_ON_EFFECTIVE_DATE',
    financialPendingBehavior: 'RESERVE_SEAT_AND_HOLD_FUTURE_FINANCIAL_CYCLE',
    exceptions: 'AUDITED_MANUAL_ACTION_ONLY',
  };
}

function campaignDTO(campaign: {
  id: string;
  contaId: string;
  targetPeriodId: string;
  nome: string;
  descricao: string | null;
  campaignStartsAt: Date;
  campaignEndsAt: Date | null;
  rules: Prisma.JsonValue | null;
  audienceDefinition: Prisma.JsonValue | null;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: { participantes?: number; processos?: number };
}) {
  return {
    id: campaign.id,
    targetPeriodId: campaign.targetPeriodId,
    nome: campaign.nome,
    descricao: campaign.descricao,
    campaignStartsAt: campaign.campaignStartsAt.toISOString(),
    campaignEndsAt: toIso(campaign.campaignEndsAt),
    rules: campaign.rules ?? null,
    audienceDefinition: campaign.audienceDefinition ?? null,
    status: campaign.status,
    version: campaign.version,
    metrics: {
      participantes: campaign._count?.participantes ?? 0,
      processos: campaign._count?.processos ?? 0,
    },
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}

function processDTO(processo: {
  id: string;
  campanhaId: string | null;
  origin: string;
  targetPeriodId: string;
  holderType: string;
  holderId: string;
  status: string;
  effectiveAt: Date;
  firstDueDate: Date | null;
  confirmedAt: Date | null;
  renewCount: number;
  pendingCount: number;
  nonRenewalCount: number;
  monthlyTotal: unknown;
  enrollmentFeeTotal: unknown;
  version: number;
  previewHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  campanha?: { id: string; nome: string; status: string } | null;
  itens?: Array<{
    id: string;
    decision: string;
    status: string;
    matriculaOrigemId: string;
    matriculaFuturaId: string | null;
    targetType: string | null;
    targetClassId: string | null;
    targetComboId: string | null;
    targetPlanId: string | null;
    effectiveAt: Date | null;
    targetSnapshot?: unknown;
    matriculaOrigem?: {
      id: string;
      dataInicio: Date;
      dataFimContrato: Date;
      status: string;
      statusContrato: string;
      taxaMatricula?: unknown;
      taxaIsenta?: boolean;
      taxaJustificativa?: string | null;
      formaPagamento?: string | null;
      formaPagamentoTaxa?: string | null;
      vencimentoDia?: number | null;
      jurosMensal?: unknown;
      multaPercentual?: unknown;
      descontoAntecipado?: unknown;
      prazoDesconto?: number | null;
      aluno?: {
        id: string;
        nome: string;
        dataNasc?: Date | null;
        cpf?: string | null;
        foto?: string | null;
        asaasCustomerId?: string | null;
      } | null;
      responsavelFinanceiroId?: string | null;
      responsavelFinanceiro?: { asaasCustomerId?: string | null } | null;
      turma?: { id: string; nome: string } | null;
      plano?: { id: string; nome: string } | null;
      combo?: { id: string; nome: string } | null;
    };
    matriculaFutura?: {
      id: string;
      dataInicio: Date;
      dataFimContrato: Date;
      turmaId: string | null;
      comboId: string | null;
      planoId: string | null;
      taxaMatricula?: unknown;
      taxaIsenta?: boolean;
      taxaJustificativa?: string | null;
      formaPagamento?: string | null;
      formaPagamentoTaxa?: string | null;
      vencimentoDia?: number | null;
      jurosMensal?: unknown;
      multaPercentual?: unknown;
      descontoAntecipado?: unknown;
      prazoDesconto?: number | null;
      plano?: { id: string; nome: string } | null;
      combo?: { id: string; nome: string } | null;
      turma?: { id: string; nome: string } | null;
    } | null;
  }>;
  reservas?: Array<{ id: string; status: string; targetClassId: string | null; effectiveAt: Date }>;
  contratos?: Array<{ id: string; status: string; contractModelId: string | null; validFrom: Date | null; validUntil: Date | null }>;
  financeiros?: Array<{
    id: string;
    status: string;
    monthlyTotal: unknown;
    enrollmentFeeTotal: unknown;
    firstDueDate: Date | null;
    effectiveAt: Date;
    provisionAt: Date | null;
    feeChargeMoment: string;
    feeUnit: string;
    feePurpose: string;
    responsavelId?: string | null;
    asaasSubscriptionId: string | null;
    asaasPaymentId: string | null;
    snapshot?: unknown;
  }>;
  pendencias?: Array<{
    id: string;
    type: string;
    severity: string;
    status: string;
    code: string;
    title: string;
    message: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }>;
  excecoes?: Array<{
    id: string;
    permission: string;
    rule: string;
    impact: string;
    justification: string;
    status: string;
    createdAt: Date;
  }>;
  comunicacoes?: Array<{
    id: string;
    channel: string;
    audience: string;
    status: string;
    subject: string | null;
    scheduledAt: Date | null;
    sentAt: Date | null;
    createdAt: Date;
  }>;
}) {
  return {
    id: processo.id,
    campanhaId: processo.campanhaId,
    campanha: processo.campanha ?? null,
    origin: processo.origin,
    targetPeriodId: processo.targetPeriodId,
    holderType: processo.holderType,
    holderId: processo.holderId,
    status: processo.status,
    effectiveAt: processo.effectiveAt.toISOString(),
    firstDueDate: toIso(processo.firstDueDate),
    confirmedAt: toIso(processo.confirmedAt),
    renewCount: processo.renewCount,
    pendingCount: processo.pendingCount,
    nonRenewalCount: processo.nonRenewalCount,
    monthlyTotal: toNumber(processo.monthlyTotal),
    enrollmentFeeTotal: toNumber(processo.enrollmentFeeTotal),
    version: processo.version,
    previewHash: processo.previewHash,
    createdAt: processo.createdAt.toISOString(),
    updatedAt: processo.updatedAt.toISOString(),
    itens:
      processo.itens?.map((item) => ({
        id: item.id,
        decision: item.decision,
        status: item.status,
        matriculaOrigemId: item.matriculaOrigemId,
        matriculaFuturaId: item.matriculaFuturaId,
        targetType: item.targetType,
        targetClassId: item.targetClassId,
        targetComboId: item.targetComboId,
        targetPlanId: item.targetPlanId,
        effectiveAt: toIso(item.effectiveAt),
        targetSnapshot: item.targetSnapshot ?? null,
        aluno: item.matriculaOrigem?.aluno
          ? {
              id: item.matriculaOrigem.aluno.id,
              nome: item.matriculaOrigem.aluno.nome,
              dataNascimento: toIso(item.matriculaOrigem.aluno.dataNasc),
              cpf: item.matriculaOrigem.aluno.cpf,
              foto: item.matriculaOrigem.aluno.foto,
              customerId:
                item.matriculaOrigem.responsavelFinanceiro?.asaasCustomerId ??
                item.matriculaOrigem.aluno.asaasCustomerId ??
                null,
              responsavelFinanceiroId: item.matriculaOrigem.responsavelFinanceiroId ?? null,
            }
          : null,
        matriculaAtual: item.matriculaOrigem
          ? {
              id: item.matriculaOrigem.id,
              dataInicio: item.matriculaOrigem.dataInicio.toISOString(),
              dataFimContrato: item.matriculaOrigem.dataFimContrato.toISOString(),
              status: item.matriculaOrigem.status,
              statusContrato: item.matriculaOrigem.statusContrato,
              taxaMatricula: toNumber(item.matriculaOrigem.taxaMatricula),
              taxaIsenta: item.matriculaOrigem.taxaIsenta,
              taxaJustificativa: item.matriculaOrigem.taxaJustificativa,
              formaPagamento: item.matriculaOrigem.formaPagamento,
              formaPagamentoTaxa: item.matriculaOrigem.formaPagamentoTaxa,
              vencimentoDia: item.matriculaOrigem.vencimentoDia,
              jurosMensal: toNumber(item.matriculaOrigem.jurosMensal),
              multaPercentual: toNumber(item.matriculaOrigem.multaPercentual),
              descontoAntecipado: toNumber(item.matriculaOrigem.descontoAntecipado),
              prazoDesconto: item.matriculaOrigem.prazoDesconto,
            }
          : null,
        matriculaFutura: item.matriculaFutura
          ? {
              id: item.matriculaFutura.id,
              dataInicio: item.matriculaFutura.dataInicio.toISOString(),
              dataFimContrato: item.matriculaFutura.dataFimContrato.toISOString(),
              turmaId: item.matriculaFutura.turmaId,
              comboId: item.matriculaFutura.comboId,
              planoId: item.matriculaFutura.planoId,
              taxaMatricula: toNumber(item.matriculaFutura.taxaMatricula),
              taxaIsenta: item.matriculaFutura.taxaIsenta,
              taxaJustificativa: item.matriculaFutura.taxaJustificativa,
              formaPagamento: item.matriculaFutura.formaPagamento,
              formaPagamentoTaxa: item.matriculaFutura.formaPagamentoTaxa,
              vencimentoDia: item.matriculaFutura.vencimentoDia,
              jurosMensal: toNumber(item.matriculaFutura.jurosMensal),
              multaPercentual: toNumber(item.matriculaFutura.multaPercentual),
              descontoAntecipado: toNumber(item.matriculaFutura.descontoAntecipado),
              prazoDesconto: item.matriculaFutura.prazoDesconto,
              plano: item.matriculaFutura.plano ?? null,
              combo: item.matriculaFutura.combo ?? null,
              turma: item.matriculaFutura.turma ?? null,
            }
          : null,
        turmaAtual: item.matriculaOrigem?.turma ?? null,
        planoAtual: item.matriculaOrigem?.plano ?? null,
        comboAtual: item.matriculaOrigem?.combo ?? null,
      })) ?? [],
    reservas:
      processo.reservas?.map((reserva) => ({
        id: reserva.id,
        status: reserva.status,
        targetClassId: reserva.targetClassId,
        effectiveAt: reserva.effectiveAt.toISOString(),
      })) ?? [],
    contratos:
      processo.contratos?.map((contrato) => ({
        id: contrato.id,
        status: contrato.status,
        contractModelId: contrato.contractModelId,
        validFrom: toIso(contrato.validFrom),
        validUntil: toIso(contrato.validUntil),
      })) ?? [],
    financeiros:
      processo.financeiros?.map((financeiro) => ({
        id: financeiro.id,
        status: financeiro.status,
        monthlyTotal: toNumber(financeiro.monthlyTotal),
        enrollmentFeeTotal: toNumber(financeiro.enrollmentFeeTotal),
        firstDueDate: toIso(financeiro.firstDueDate),
        effectiveAt: financeiro.effectiveAt.toISOString(),
        provisionAt: toIso(financeiro.provisionAt),
        feeChargeMoment: financeiro.feeChargeMoment,
        feeUnit: financeiro.feeUnit,
        feePurpose: financeiro.feePurpose,
        asaasSubscriptionId: financeiro.asaasSubscriptionId,
        asaasPaymentId: financeiro.asaasPaymentId,
        snapshot: financeiro.snapshot ?? null,
      })) ?? [],
    pendencias:
      processo.pendencias?.map((pendencia) => ({
        id: pendencia.id,
        type: pendencia.type,
        severity: pendencia.severity,
        status: pendencia.status,
        code: pendencia.code,
        title: pendencia.title,
        message: pendencia.message,
        createdAt: pendencia.createdAt.toISOString(),
        resolvedAt: toIso(pendencia.resolvedAt),
      })) ?? [],
    excecoes:
      processo.excecoes?.map((excecao) => ({
        id: excecao.id,
        permission: excecao.permission,
        rule: excecao.rule,
        impact: excecao.impact,
        justification: excecao.justification,
        status: excecao.status,
        createdAt: excecao.createdAt.toISOString(),
      })) ?? [],
    comunicacoes:
      processo.comunicacoes?.map((comunicacao) => ({
        id: comunicacao.id,
        channel: comunicacao.channel,
        audience: comunicacao.audience,
        status: comunicacao.status,
        subject: comunicacao.subject,
        scheduledAt: toIso(comunicacao.scheduledAt),
        sentAt: toIso(comunicacao.sentAt),
        createdAt: comunicacao.createdAt.toISOString(),
      })) ?? [],
  };
}

export async function createRenewalCampaign(input: CreateRenewalCampaignInput, deps: { prisma: PrismaClient }) {
  const campaign = await deps.prisma.rematriculaCampanha.create({
    data: {
      contaId: input.contaId,
      nome: input.nome,
      descricao: input.descricao ?? null,
      targetPeriodId: input.targetPeriodId,
      campaignStartsAt: input.campaignStartsAt,
      campaignEndsAt: input.campaignEndsAt ?? null,
      rules: buildCanonicalCampaignRules(),
      audienceDefinition: (input.audienceDefinition ?? {}) as Prisma.InputJsonValue,
      status: input.status ?? 'ACTIVE',
      createdById: input.actorId,
    },
    include: { _count: { select: { participantes: true, processos: true } } },
  });

  await deps.prisma.rematriculaAuditLog.create({
    data: {
      contaId: input.contaId,
      campanhaId: campaign.id,
      actorId: input.actorId,
      action: 'CAMPAIGN_CREATED',
      afterState: campaignDTO(campaign) as Prisma.InputJsonValue,
    },
  });

  return campaignDTO(campaign);
}

export async function updateRenewalCampaign(input: UpdateRenewalCampaignInput, deps: { prisma: PrismaClient }) {
  return deps.prisma.$transaction(async (tx) => {
    const before = await tx.rematriculaCampanha.findFirst({
      where: { id: input.campaignId, contaId: input.contaId },
      include: { _count: { select: { participantes: true, processos: true } } },
    });
    if (!before) throw new Error('CAMPANHA_NAO_ENCONTRADA');
    if (before.status === 'ARCHIVED') throw new Error('CAMPANHA_ARQUIVADA');

    const updated = await tx.rematriculaCampanha.update({
      where: { id: before.id },
      data: {
        ...(input.nome !== undefined ? { nome: input.nome } : {}),
        ...(input.descricao !== undefined ? { descricao: input.descricao } : {}),
        ...(input.targetPeriodId !== undefined ? { targetPeriodId: input.targetPeriodId } : {}),
        ...(input.campaignStartsAt !== undefined ? { campaignStartsAt: input.campaignStartsAt } : {}),
        ...(input.campaignEndsAt !== undefined ? { campaignEndsAt: input.campaignEndsAt } : {}),
        rules: buildCanonicalCampaignRules(),
        ...(input.audienceDefinition !== undefined
          ? { audienceDefinition: (input.audienceDefinition ?? {}) as Prisma.InputJsonValue }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        version: { increment: 1 },
      },
      include: { _count: { select: { participantes: true, processos: true } } },
    });

    await tx.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        campanhaId: updated.id,
        actorId: input.actorId,
        action: 'CAMPAIGN_UPDATED',
        beforeState: campaignDTO(before) as Prisma.InputJsonValue,
        afterState: campaignDTO(updated) as Prisma.InputJsonValue,
      },
    });

    return campaignDTO(updated);
  });
}

export async function deleteRenewalCampaign(
  input: { contaId: string; actorId: string; campaignId: string },
  deps: { prisma: PrismaClient },
): Promise<DeleteRenewalCampaignResult> {
  return deps.prisma.$transaction(async (tx) => {
    const campaign = await tx.rematriculaCampanha.findFirst({
      where: { id: input.campaignId, contaId: input.contaId },
      include: { _count: { select: { participantes: true, processos: true } } },
    });
    if (!campaign) throw new Error('CAMPANHA_NAO_ENCONTRADA');

    const [pendencias, excecoes, comunicacoes] = await Promise.all([
      tx.rematriculaPendencia.count({ where: { contaId: input.contaId, campanhaId: campaign.id } }),
      tx.rematriculaExcecao.count({ where: { contaId: input.contaId, campanhaId: campaign.id } }),
      tx.rematriculaComunicacao.count({ where: { contaId: input.contaId, campanhaId: campaign.id } }),
    ]);
    const hasOperationalHistory =
      campaign._count.participantes > 0 ||
      campaign._count.processos > 0 ||
      pendencias > 0 ||
      excecoes > 0 ||
      comunicacoes > 0;

    if (!hasOperationalHistory) {
      await tx.rematriculaAuditLog.deleteMany({ where: { contaId: input.contaId, campanhaId: campaign.id } });
      await tx.rematriculaCampanha.delete({ where: { id: campaign.id } });
      return { deleted: true, mode: 'HARD_DELETE', campaignId: campaign.id };
    }

    const deleted = await tx.rematriculaCampanha.update({
      where: { id: campaign.id },
      data: { status: 'DELETED', version: { increment: 1 } },
      include: { _count: { select: { participantes: true, processos: true } } },
    });

    await tx.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        campanhaId: deleted.id,
        actorId: input.actorId,
        action: 'CAMPAIGN_DELETED',
        beforeState: campaignDTO(campaign) as Prisma.InputJsonValue,
        afterState: campaignDTO(deleted) as Prisma.InputJsonValue,
        metadata: {
          mode: 'SOFT_DELETE',
          history: {
            participantes: campaign._count.participantes,
            processos: campaign._count.processos,
            pendencias,
            excecoes,
            comunicacoes,
          },
        } as Prisma.InputJsonValue,
      },
    });

    return { deleted: true, mode: 'SOFT_DELETE', campaignId: campaign.id };
  });
}

export async function activateRenewalCampaign(
  input: { contaId: string; actorId: string; campaignId: string },
  deps: { prisma: PrismaClient },
) {
  const campaign = await deps.prisma.rematriculaCampanha.findFirst({
    where: { id: input.campaignId, contaId: input.contaId },
  });
  if (!campaign) throw new Error('CAMPANHA_NAO_ENCONTRADA');
  if (campaign.status === 'ARCHIVED') throw new Error('CAMPANHA_ARQUIVADA');

  const elegiveis = await listarRematriculasElegiveis({
    contaId: input.contaId,
    diasAntecedencia: readDiasAntecedencia(campaign.audienceDefinition),
    currentUserRole: 'ADMIN',
  });

  const existing = await deps.prisma.rematriculaParticipante.findMany({
    where: { contaId: input.contaId, campanhaId: campaign.id },
    select: { matriculaOrigemId: true },
  });
  const existingIds = new Set(existing.map((item) => item.matriculaOrigemId));

  const created = await deps.prisma.$transaction(async (tx) => {
    let createdCount = 0;
    for (const item of elegiveis.itens) {
      if (existingIds.has(item.id)) continue;
      await tx.rematriculaParticipante.create({
        data: {
          contaId: input.contaId,
          campanhaId: campaign.id,
          matriculaOrigemId: item.id,
          alunoId: item.aluno.id,
          responsavelId: item.responsavelFinanceiro?.id ?? null,
          currentClassId: item.turma?.id ?? null,
          currentContractEndsAt: item.dataFimContrato,
          eligibilityReason: item.podeRenovar ? 'ELEGIVEL_POR_CONTRATO' : 'NAO_ELEGIVEL_NO_SNAPSHOT',
          status: item.podeRenovar ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
          includedById: input.actorId,
          eligibilitySnapshot: {
            diasRestantes: item.diasRestantes,
            contratoExpirado: item.contratoExpirado,
            financeiro: item.financeiro,
            aluno: item.aluno,
            turma: item.turma,
            plano: item.plano,
            combo: item.combo,
          } as Prisma.InputJsonValue,
        },
      });
      createdCount += 1;
    }

    const status = campaign.campaignStartsAt > new Date() ? 'SCHEDULED' : 'ACTIVE';
    const updated = await tx.rematriculaCampanha.update({
      where: { id: campaign.id },
      data: { status, version: { increment: 1 } },
      include: { _count: { select: { participantes: true, processos: true } } },
    });

    await tx.rematriculaAuditLog.create({
      data: {
        contaId: input.contaId,
        campanhaId: campaign.id,
        actorId: input.actorId,
        action: 'CAMPAIGN_ACTIVATED',
        metadata: {
          createdParticipants: createdCount,
          eligibleSnapshotTotal: elegiveis.total,
        } as Prisma.InputJsonValue,
      },
    });

    return { campaign: updated, createdCount };
  });

  return {
    campaign: campaignDTO(created.campaign),
    createdParticipants: created.createdCount,
  };
}

export async function listRenewalManagement(
  input: {
    contaId: string;
    diasAntecedencia?: number;
    referencia?: Date;
    statusContrato?: any;
    search?: string;
    currentUserRole?: string | null;
    campaignId?: string | null;
    targetPeriodId?: string | null;
    processStatus?: string | null;
  },
  deps: { prisma: PrismaClient },
) {
  const [eligible, campaigns, processes, participants] = await Promise.all([
    listarRematriculasElegiveis({
      contaId: input.contaId,
      diasAntecedencia: input.diasAntecedencia,
      referencia: input.referencia,
      statusContrato: input.statusContrato,
      search: input.search,
      currentUserRole: input.currentUserRole,
    }),
    deps.prisma.rematriculaCampanha.findMany({
      where: {
        contaId: input.contaId,
        status: { not: 'ARCHIVED' },
        ...(input.campaignId ? { id: input.campaignId } : {}),
        ...(input.targetPeriodId ? { targetPeriodId: input.targetPeriodId } : {}),
      },
      orderBy: [{ status: 'asc' }, { campaignStartsAt: 'desc' }],
      include: { _count: { select: { participantes: true, processos: true } } },
      take: 50,
    }),
    deps.prisma.rematriculaProcesso.findMany({
      where: {
        contaId: input.contaId,
        ...(input.campaignId ? { campanhaId: input.campaignId } : {}),
        ...(input.targetPeriodId ? { targetPeriodId: input.targetPeriodId } : {}),
        ...(input.processStatus ? { status: input.processStatus as any } : {}),
      },
      orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        campanha: { select: { id: true, nome: true, status: true } },
        itens: {
          include: {
            matriculaOrigem: {
              select: {
                id: true,
                dataInicio: true,
                dataFimContrato: true,
                status: true,
                statusContrato: true,
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
                aluno: { select: { id: true, nome: true, dataNasc: true, cpf: true, foto: true, asaasCustomerId: true } },
                responsavelFinanceiro: { select: { asaasCustomerId: true } },
                turma: { select: { id: true, nome: true } },
                plano: { select: { id: true, nome: true } },
                combo: { select: { id: true, nome: true } },
              },
            },
            matriculaFutura: {
              select: {
                id: true,
                dataInicio: true,
                dataFimContrato: true,
                turmaId: true,
                comboId: true,
                planoId: true,
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
                turma: { select: { id: true, nome: true } },
                plano: { select: { id: true, nome: true } },
                combo: { select: { id: true, nome: true } },
              },
            },
          },
        },
        reservas: { select: { id: true, status: true, targetClassId: true, effectiveAt: true } },
        contratos: {
          select: {
            id: true,
            status: true,
            contractModelId: true,
            validFrom: true,
            validUntil: true,
          },
        },
        financeiros: {
          select: {
            id: true,
            status: true,
            monthlyTotal: true,
            enrollmentFeeTotal: true,
            firstDueDate: true,
            effectiveAt: true,
            provisionAt: true,
            feeChargeMoment: true,
            feeUnit: true,
            feePurpose: true,
            responsavelId: true,
            asaasSubscriptionId: true,
            asaasPaymentId: true,
            snapshot: true,
          },
        },
        pendencias: {
          select: {
            id: true,
            type: true,
            severity: true,
            status: true,
            code: true,
            title: true,
            message: true,
            createdAt: true,
            resolvedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        excecoes: {
          select: {
            id: true,
            permission: true,
            rule: true,
            impact: true,
            justification: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        comunicacoes: {
          select: {
            id: true,
            channel: true,
            audience: true,
            status: true,
            subject: true,
            scheduledAt: true,
            sentAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
      take: 100,
    }),
    deps.prisma.rematriculaParticipante.findMany({
      where: {
        contaId: input.contaId,
        ...(input.campaignId ? { campanhaId: input.campaignId } : {}),
      },
      orderBy: { includedAt: 'desc' },
      select: {
        id: true,
        campanhaId: true,
        matriculaOrigemId: true,
        alunoId: true,
        responsavelId: true,
        status: true,
        eligibilityReason: true,
        currentContractEndsAt: true,
        includedAt: true,
        eligibilitySnapshot: true,
      },
      take: 200,
    }),
  ]);

  const operationalProcessBySource = new Map<string, { processId: string; rank: number; createdAt: Date }>();
  for (const processo of processes) {
    const rank = processo.status === 'CANCELLED' ? 1 : 2;
    for (const item of processo.itens) {
      const key = [
        processo.campanhaId ?? 'STANDALONE',
        processo.targetPeriodId,
        item.matriculaOrigemId,
      ].join(':');
      const current = operationalProcessBySource.get(key);
      if (!current || rank > current.rank || (rank === current.rank && processo.createdAt > current.createdAt)) {
        operationalProcessBySource.set(key, { processId: processo.id, rank, createdAt: processo.createdAt });
      }
    }
  }

  const operationalProcesses = processes.filter((processo) => {
    if (processo.itens.length === 0) return true;
    return processo.itens.some((item) => {
      const key = [
        processo.campanhaId ?? 'STANDALONE',
        processo.targetPeriodId,
        item.matriculaOrigemId,
      ].join(':');
      return operationalProcessBySource.get(key)?.processId === processo.id;
    });
  });

  return {
    eligible,
    campaigns: campaigns.filter((campaign) => campaign.status !== 'DELETED').map(campaignDTO),
    participants: participants.map((participant) => ({
      id: participant.id,
      campanhaId: participant.campanhaId,
      matriculaOrigemId: participant.matriculaOrigemId,
      alunoId: participant.alunoId,
      responsavelId: participant.responsavelId,
      status: participant.status,
      eligibilityReason: participant.eligibilityReason,
      currentContractEndsAt: toIso(participant.currentContractEndsAt),
      includedAt: participant.includedAt.toISOString(),
      snapshot: participant.eligibilitySnapshot,
    })),
    processes: operationalProcesses.map(processDTO),
    history: [...processes]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(processDTO),
  };
}

function targetPeriodRange(targetPeriodId: string, fallback: Date) {
  const year = /^\d{4}$/.test(targetPeriodId) ? Number(targetPeriodId) : null;
  if (year === null) {
    const start = new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate()));
    const end = new Date(start);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    return { start, end };
  }

  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

function capacityStatus(capacidade: number, ocupadas: number) {
  if (capacidade <= 0) return 'EXCEDIDA' as const;
  if (ocupadas > capacidade) return 'EXCEDIDA' as const;
  if (ocupadas >= capacidade) return 'LOTADA' as const;
  if (ocupadas / capacidade >= 0.9) return 'PROXIMA_DO_LIMITE' as const;
  return 'DISPONIVEL' as const;
}

/**
 * Read model operacional da campanha agrupado por turma destino.
 * A consulta é deliberadamente separada da listagem geral: a tela precisa
 * considerar todas as ocupações do ciclo, inclusive reservas/processos de
 * outras campanhas, sem depender do limite da listagem de processos.
 */
export async function getRenewalCampaignOverview(
  input: { contaId: string; campaignId: string },
  deps: { prisma: PrismaLike },
): Promise<RenewalCampaignOverview> {
  const campaign = await deps.prisma.rematriculaCampanha.findFirst({
    where: { id: input.campaignId, contaId: input.contaId },
    select: { id: true, targetPeriodId: true, campaignStartsAt: true },
  });
  if (!campaign) throw new Error('CAMPANHA_NAO_ENCONTRADA');

  const processes = await deps.prisma.rematriculaProcesso.findMany({
    where: {
      contaId: input.contaId,
      campanhaId: campaign.id,
      targetPeriodId: campaign.targetPeriodId,
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      status: true,
      itens: {
        where: { decision: 'RENEW', status: { not: 'CANCELLED' } },
        select: {
          id: true,
          status: true,
          decision: true,
          targetClassId: true,
          targetComboId: true,
          matriculaOrigem: {
            select: { aluno: { select: { id: true, nome: true, foto: true } } },
          },
        },
      },
      reservas: {
        where: { status: { in: ['RESERVED', 'WAITLISTED', 'CONVERTED'] } },
        select: { id: true, itemId: true, targetClassId: true, status: true, matriculaFuturaId: true },
      },
    },
  });

  const comboIds = Array.from(
    new Set(
      processes.flatMap((process) =>
        process.itens.map((item) => item.targetComboId).filter((id): id is string => Boolean(id)),
      ),
    ),
  );
  const directClassIds = Array.from(
    new Set(
      processes.flatMap((process) =>
        process.itens.map((item) => item.targetClassId).filter((id): id is string => Boolean(id)),
      ),
    ),
  );

  const combos = comboIds.length
    ? await deps.prisma.combo.findMany({
        where: { contaId: input.contaId, id: { in: comboIds } },
        select: {
          id: true,
          turmas: { select: { turma: { select: { id: true } } } },
        },
      })
    : [];
  const comboClasses = new Map(
    combos.map((combo) => [combo.id, combo.turmas.map((entry) => entry.turma.id)]),
  );
  const classIds = Array.from(
    new Set([
      ...directClassIds,
      ...Array.from(comboClasses.values()).flat(),
    ]),
  );

  const [classes, reservations, enrollments] = await Promise.all([
    classIds.length
      ? deps.prisma.turma.findMany({
          where: { contaId: input.contaId, id: { in: classIds } },
          select: { id: true, nome: true, capacidade: true },
          orderBy: { nome: 'asc' },
        })
      : [],
    classIds.length
      ? deps.prisma.reservaVagaFutura.findMany({
          where: {
            contaId: input.contaId,
            targetClassId: { in: classIds },
            targetPeriodId: campaign.targetPeriodId,
            status: { in: ['RESERVED', 'WAITLISTED', 'CONVERTED'] },
          },
          select: { id: true, itemId: true, targetClassId: true, status: true, matriculaFuturaId: true },
        })
      : [],
    classIds.length
      ? deps.prisma.matricula.findMany({
          where: {
            contaId: input.contaId,
            OR: [
              { turmaId: { in: classIds } },
              { matriculaTurmas: { some: { turmaId: { in: classIds } } } },
            ],
            ...buildSeatOccupancyOverlapWhereClause(
              targetPeriodRange(campaign.targetPeriodId, campaign.campaignStartsAt).start,
              targetPeriodRange(campaign.targetPeriodId, campaign.campaignStartsAt).end,
            ),
          },
          select: {
            id: true,
            turmaId: true,
            matriculaTurmas: { select: { turmaId: true } },
          },
        })
      : [],
  ]);

  const classById = new Map(classes.map((turma) => [turma.id, turma]));
  const occupiedEnrollmentIdsByClass = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    const enrollmentClassIds = new Set([
      ...(enrollment.turmaId ? [enrollment.turmaId] : []),
      ...enrollment.matriculaTurmas.map((entry) => entry.turmaId),
    ]);
    for (const classId of enrollmentClassIds) {
      if (!classById.has(classId)) continue;
      const ids = occupiedEnrollmentIdsByClass.get(classId) ?? new Set<string>();
      ids.add(enrollment.id);
      occupiedEnrollmentIdsByClass.set(classId, ids);
    }
  }

  const reservationByItemAndClass = new Map<string, string>();
  const reservationCountByClass = new Map<string, number>();
  for (const reservation of reservations) {
    if (!reservation.targetClassId) continue;
    reservationCountByClass.set(
      reservation.targetClassId,
      (reservationCountByClass.get(reservation.targetClassId) ?? 0) + 1,
    );
    if (reservation.itemId) {
      reservationByItemAndClass.set(`${reservation.itemId}:${reservation.targetClassId}`, reservation.status);
    }
    if (!reservation.matriculaFuturaId) {
      const ids = occupiedEnrollmentIdsByClass.get(reservation.targetClassId) ?? new Set<string>();
      ids.add(`reservation:${reservation.id}`);
      occupiedEnrollmentIdsByClass.set(reservation.targetClassId, ids);
    }
  }

  const rowsByClass = new Map<
    string,
    RenewalCampaignClassOverview['alunos']
  >();
  let inconsistenciasSemTurma = 0;
  const confirmedProcessStatuses = new Set(['CONFIRMED', 'WAITING_FOR_START', 'EFFECTIVE', 'COMPLETED']);

  for (const process of processes) {
    for (const item of process.itens) {
      const targetClassIds = item.targetClassId
        ? [item.targetClassId]
        : item.targetComboId
          ? comboClasses.get(item.targetComboId) ?? []
          : [];
      if (targetClassIds.length === 0) {
        inconsistenciasSemTurma += 1;
        continue;
      }

      const aluno = item.matriculaOrigem.aluno;
      for (const targetClassId of targetClassIds) {
        if (!classById.has(targetClassId) || !aluno) continue;
        const rows = rowsByClass.get(targetClassId) ?? [];
        rows.push({
          processoId: process.id,
          itemId: item.id,
          alunoId: aluno.id,
          alunoNome: aluno.nome ?? 'Aluno sem nome',
          alunoFoto: aluno.foto ?? null,
          processoStatus: process.status,
          itemStatus: item.status,
          reservaStatus: reservationByItemAndClass.get(`${item.id}:${targetClassId}`) ?? null,
        });
        rowsByClass.set(targetClassId, rows);
      }
    }
  }

  const turmas = classes.map((turma) => {
    const alunos = rowsByClass.get(turma.id) ?? [];
    const confirmados = alunos.filter(
      (aluno) => aluno.itemStatus === 'RENEWED' || confirmedProcessStatuses.has(aluno.processoStatus),
    ).length;
    const pendentes = alunos.length - confirmados;
    const ocupadas = occupiedEnrollmentIdsByClass.get(turma.id)?.size ?? 0;
    const capacidade = turma.capacidade;
    return {
      turmaId: turma.id,
      turmaNome: turma.nome,
      capacidade,
      ocupadas,
      reservasAtivas: reservationCountByClass.get(turma.id) ?? 0,
      confirmados,
      pendentes,
      vagasDisponiveis: Math.max(0, capacidade - ocupadas),
      percentualOcupacao: capacidade > 0 ? Math.round((ocupadas / capacidade) * 100) : 0,
      statusCapacidade: capacityStatus(capacidade, ocupadas),
      alunos: alunos.sort((a, b) => a.alunoNome.localeCompare(b.alunoNome, 'pt-BR')),
    } satisfies RenewalCampaignClassOverview;
  });

  const allRows = Array.from(rowsByClass.values()).flat();
  const allItemIds = new Set(allRows.map((row) => row.itemId));
  const confirmedItemIds = new Set(
    allRows
      .filter((row) => row.itemStatus === 'RENEWED' || confirmedProcessStatuses.has(row.processoStatus))
      .map((row) => row.itemId),
  );
  const studentIds = new Set(allRows.map((row) => row.alunoId));

  return {
    campaignId: campaign.id,
    targetPeriodId: campaign.targetPeriodId,
    totalTurmas: turmas.length,
    totalAlunos: studentIds.size,
    totalConfirmados: confirmedItemIds.size,
    totalPendentes: Math.max(0, allItemIds.size - confirmedItemIds.size),
    totalOcupadas: turmas.reduce((total, turma) => total + turma.ocupadas, 0),
    totalCapacidade: turmas.reduce((total, turma) => total + turma.capacidade, 0),
    totalVagasDisponiveis: turmas.reduce((total, turma) => total + turma.vagasDisponiveis, 0),
    inconsistenciasSemTurma,
    turmas,
  };
}

export async function getRenewalProcessDetail(
  input: { contaId: string; processId: string },
  deps: { prisma: PrismaLike },
) {
  const processo = await deps.prisma.rematriculaProcesso.findFirst({
    where: { id: input.processId, contaId: input.contaId },
    include: {
      campanha: { select: { id: true, nome: true, status: true } },
      itens: {
        include: {
          matriculaOrigem: {
            select: {
              id: true,
              dataInicio: true,
              dataFimContrato: true,
              status: true,
              statusContrato: true,
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
              aluno: { select: { id: true, nome: true, dataNasc: true, cpf: true, foto: true, asaasCustomerId: true } },
              responsavelFinanceiroId: true,
              responsavelFinanceiro: { select: { asaasCustomerId: true } },
              turma: { select: { id: true, nome: true } },
              plano: { select: { id: true, nome: true } },
              combo: { select: { id: true, nome: true } },
            },
          },
          matriculaFutura: {
            select: {
              id: true,
              dataInicio: true,
              dataFimContrato: true,
              turmaId: true,
              comboId: true,
              planoId: true,
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
              turma: { select: { id: true, nome: true } },
              plano: { select: { id: true, nome: true } },
              combo: { select: { id: true, nome: true } },
            },
          },
        },
      },
      reservas: { select: { id: true, status: true, targetClassId: true, effectiveAt: true } },
      contratos: {
        select: { id: true, status: true, contractModelId: true, validFrom: true, validUntil: true },
      },
      financeiros: {
        select: {
          id: true,
          status: true,
          monthlyTotal: true,
          enrollmentFeeTotal: true,
          firstDueDate: true,
          effectiveAt: true,
          provisionAt: true,
          feeChargeMoment: true,
          feeUnit: true,
          feePurpose: true,
          responsavelId: true,
          asaasSubscriptionId: true,
          asaasPaymentId: true,
          snapshot: true,
        },
      },
      pendencias: {
        select: {
          id: true,
          type: true,
          severity: true,
          status: true,
          code: true,
          title: true,
          message: true,
          createdAt: true,
          resolvedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      excecoes: {
        select: {
          id: true,
          permission: true,
          rule: true,
          impact: true,
          justification: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      comunicacoes: {
        select: {
          id: true,
          channel: true,
          audience: true,
          status: true,
          subject: true,
          scheduledAt: true,
          sentAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!processo) throw new Error('REMATRICULA_NAO_ENCONTRADA');

  const payerKeys = (processo.itens ?? []).flatMap((item) => {
    const responsavelId = item.matriculaOrigem.responsavelFinanceiroId ?? processo.financeiros[0]?.responsavelId ?? null;
    const alunoId = item.matriculaOrigem.aluno?.id ?? null;
    return responsavelId
      ? [{ payerType: 'RESPONSAVEL' as const, payerId: responsavelId }]
      : alunoId
        ? [{ payerType: 'ALUNO' as const, payerId: alunoId }]
        : [];
  });
  const customers = payerKeys.length
    ? await deps.prisma.customer.findMany({
        where: {
          contaId: input.contaId,
          OR: payerKeys,
        },
        select: { payerType: true, payerId: true, asaasCustomerId: true },
      })
    : [];
  const customerByPayer = new Map(customers.map((customer) => [`${customer.payerType}:${customer.payerId}`, customer.asaasCustomerId]));
  const detail = processDTO(processo);
  detail.itens?.forEach((item, index) => {
    const source = processo.itens?.[index];
    if (!source?.matriculaOrigem.aluno || !item.aluno) return;
    const responsavelId = source.matriculaOrigem.responsavelFinanceiroId ?? processo.financeiros[0]?.responsavelId ?? null;
    const payerKey = responsavelId
      ? `RESPONSAVEL:${responsavelId}`
      : `ALUNO:${source.matriculaOrigem.aluno.id}`;
    item.aluno.customerId = customerByPayer.get(payerKey) ?? item.aluno.customerId ?? null;
  });
  return detail;
}
