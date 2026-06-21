import { Prisma, type PrismaClient } from '@prisma/client';
import { listarRematriculasElegiveis } from './rematricula.service';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type CreateRenewalCampaignInput = {
  contaId: string;
  actorId: string;
  nome: string;
  descricao?: string | null;
  targetPeriodId: string;
  campaignStartsAt: Date;
  campaignEndsAt?: Date | null;
  rules?: Record<string, unknown> | null;
  audienceDefinition?: Record<string, unknown> | null;
  status?: 'DRAFT' | 'SCHEDULED' | 'ACTIVE';
};

export type UpdateRenewalCampaignInput = Partial<
  Pick<
    CreateRenewalCampaignInput,
    'nome' | 'descricao' | 'targetPeriodId' | 'campaignStartsAt' | 'campaignEndsAt' | 'rules' | 'audienceDefinition'
  >
> & {
  contaId: string;
  actorId: string;
  campaignId: string;
  status?: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';
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
    matriculaOrigem?: {
      id: string;
      aluno?: { id: string; nome: string; foto?: string | null } | null;
      turma?: { id: string; nome: string } | null;
      plano?: { id: string; nome: string } | null;
      combo?: { id: string; nome: string } | null;
    };
  }>;
  reservas?: Array<{ id: string; status: string; targetClassId: string | null; effectiveAt: Date }>;
  contratos?: Array<{ id: string; status: string; contractModelId: string | null; validFrom: Date | null; validUntil: Date | null }>;
  financeiros?: Array<{ id: string; status: string; monthlyTotal: unknown; enrollmentFeeTotal: unknown; provisionAt: Date | null; asaasSubscriptionId: string | null; asaasPaymentId: string | null }>;
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
        aluno: item.matriculaOrigem?.aluno ?? null,
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
        provisionAt: toIso(financeiro.provisionAt),
        asaasSubscriptionId: financeiro.asaasSubscriptionId,
        asaasPaymentId: financeiro.asaasPaymentId,
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
      rules: (input.rules ?? {}) as Prisma.InputJsonValue,
      audienceDefinition: (input.audienceDefinition ?? {}) as Prisma.InputJsonValue,
      status: input.status ?? 'DRAFT',
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
        ...(input.rules !== undefined ? { rules: (input.rules ?? {}) as Prisma.InputJsonValue } : {}),
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
    diasAntecedencia: readDiasAntecedencia(campaign.audienceDefinition ?? campaign.rules),
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
                aluno: { select: { id: true, nome: true, foto: true } },
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
            provisionAt: true,
            asaasSubscriptionId: true,
            asaasPaymentId: true,
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

  return {
    eligible,
    campaigns: campaigns.map(campaignDTO),
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
    processes: processes.map(processDTO),
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
              aluno: { select: { id: true, nome: true, foto: true } },
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
          provisionAt: true,
          asaasSubscriptionId: true,
          asaasPaymentId: true,
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
  return processDTO(processo);
}
