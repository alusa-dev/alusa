import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const SUPPORT_WEBHOOK_PAGE_SIZE = 7;

export type SupportWebhookFilters = {
  event?: string;
  status?: string;
  period?: string;
};

export type SupportWebhookListItem = {
  id: string;
  source: 'received' | 'rejected';
  contaId: string | null;
  conta: { nome: string };
  evento: string | null;
  eventId: string | null;
  status: string;
  recebidoEm: Date;
  processadoEm: Date | null;
  tentativas: number;
  ultimoErro: string | null;
  rejectionReason: string | null;
  asaasPaymentId: string | null;
  asaasSubscriptionId: string | null;
  asaasTransferId: string | null;
};

export type SupportWebhookPage = {
  items: SupportWebhookListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SupportWebhookHealth = {
  status: 'OK' | 'WARNING' | 'ERROR';
  statusLabel: string;
  totalReceived: number;
  processedLast24h: number;
  pending: number;
  errored: number;
  exhausted: number;
  rejectedLast24h: number;
  accountsNeedingAttention: number;
  lastReceivedAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  lastWebhookCheckAt: Date | null;
};

function webhookPeriodStart(period?: string) {
  const days = Number(period);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function webhookFilterConditions(
  alias: 'w' | 'r',
  contaId: string | undefined,
  filters: SupportWebhookFilters,
) {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  const periodStart = webhookPeriodStart(filters.period);

  if (contaId) conditions.push(Prisma.sql`${Prisma.raw(alias)}."contaId" = ${contaId}`);
  if (filters.event) conditions.push(Prisma.sql`${Prisma.raw(alias)}."evento" = ${filters.event}`);
  if (filters.status && alias === 'w') conditions.push(Prisma.sql`${Prisma.raw(alias)}."status" = ${filters.status}`);
  if (filters.status === 'REJEITADO' && alias === 'w') return null;
  if (filters.status && alias === 'r' && filters.status !== 'REJEITADO') return null;
  if (periodStart) conditions.push(Prisma.sql`${Prisma.raw(alias)}."recebidoEm" >= ${periodStart}`);

  return Prisma.join(conditions, ' AND ');
}

function unifiedWebhookSql(contaId: string | undefined, filters: SupportWebhookFilters) {
  const acceptedConditions = webhookFilterConditions('w', contaId, filters);
  const rejectedConditions = webhookFilterConditions('r', contaId, filters);
  const accepted = acceptedConditions
    ? Prisma.sql`
        SELECT
          w."id",
          'received'::text AS "source",
          w."contaId",
          c."nome" AS "contaNome",
          w."evento",
          w."eventId",
          w."status",
          w."recebidoEm",
          w."processadoEm",
          w."tentativas",
          w."ultimoErro",
          NULL::text AS "rejectionReason",
          w."asaasPaymentId",
          w."asaasSubscriptionId",
          w."asaasTransferId"
        FROM "WebhookAsaas" w
        INNER JOIN "Conta" c ON c."id" = w."contaId"
        WHERE ${acceptedConditions}
      `
    : null;
  const rejected = rejectedConditions
    ? Prisma.sql`
        SELECT
          r."id",
          'rejected'::text AS "source",
          r."contaId",
          COALESCE(c."nome", 'Origem não identificada') AS "contaNome",
          r."evento",
          r."eventId",
          'REJEITADO'::text AS "status",
          r."recebidoEm",
          NULL::timestamp AS "processadoEm",
          0::int AS "tentativas",
          NULL::text AS "ultimoErro",
          r."reason" AS "rejectionReason",
          NULL::text AS "asaasPaymentId",
          NULL::text AS "asaasSubscriptionId",
          NULL::text AS "asaasTransferId"
        FROM "WebhookAsaasRejection" r
        LEFT JOIN "Conta" c ON c."id" = r."contaId"
        WHERE ${rejectedConditions}
      `
    : null;

  return accepted && rejected ? Prisma.sql`${accepted} UNION ALL ${rejected}` : accepted ?? rejected ?? Prisma.sql`SELECT NULL WHERE FALSE`;
}

export async function getSupportAccount(contaId: string) {
  const [conta, counts, recentWebhooks] = await Promise.all([
    prisma.conta.findUnique({
      where: { id: contaId },
      select: {
        id: true,
        nome: true,
        cpfCnpj: true,
        status: true,
        financeStatus: true,
        financeIntegrationMode: true,
        externalAsaasOnboardingStatus: true,
        ownerUserId: true,
        enderecoCep: true,
        enderecoLogradouro: true,
        enderecoNumero: true,
        enderecoBairro: true,
        enderecoCidade: true,
        enderecoUf: true,
        matriculaActivationPolicy: true,
        deletedAt: true,
        deleteReason: true,
        ownerUser: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            birthDate: true,
            foto: true,
            emailVerifiedAt: true,
            role: true,
            status: true,
          },
        },
        timezone: true,
        createdAt: true,
        updatedAt: true,
        financeProfile: {
          select: {
            id: true,
            status: true,
            isOnboardingCompleted: true,
            onboardingCompletedAt: true,
            lastAsaasSyncAt: true,
            asaasAccountId: true,
            wizardStep: true,
            wizardCompletedAt: true,
            draftPersonType: true,
            draftCpfCnpj: true,
            draftBirthDate: true,
            asaasName: true,
            asaasOwnerName: true,
            asaasCompanyName: true,
            asaasLoginEmail: true,
            asaasPhone: true,
            asaasSite: true,
            mobilePhone: true,
            landlinePhone: true,
            incomeValue: true,
            address: true,
            addressNumber: true,
            province: true,
            addressCity: true,
            addressState: true,
            postalCode: true,
            complement: true,
            companyType: true,
            createdAt: true,
            updatedAt: true,
            asaasAccount: {
              select: {
                asaasAccountId: true,
                walletId: true,
                status: true,
                statusUpdatedAt: true,
                provisionedAt: true,
                provisionAttempts: true,
                provisionLastAttemptAt: true,
                provisionLastError: true,
                provisionLastHttpStatus: true,
                regulatoryBlockedAt: true,
                regulatoryBlockReason: true,
                commercialInfoStatus: true,
                commercialInfoScheduledDate: true,
                apiKeyStatus: true,
                apiKeyCreatedAt: true,
                apiKeyExpiresAt: true,
                apiKeyProjectedExpirationAt: true,
                webhookStatus: true,
                operationalStatus: true,
                lastHealthCheckAt: true,
                lastWebhookCheckAt: true,
                lastApiKeyCheckAt: true,
                lastAsaasSyncAt: true,
                lastFinanceReconciliationAt: true,
                asaasAccountEmail: true,
                documentsCacheUpdatedAt: true,
                lastAccountStatusEventAt: true,
                deletionState: true,
                deletionRequestedAt: true,
                deletedExternallyAt: true,
                deletedLocallyAt: true,
                documentsCache: true,
                kycProcess: {
                  select: {
                    id: true,
                    status: true,
                    rejectReasons: true,
                    nextAllowedDocsFetchAt: true,
                    lastWebhookEventId: true,
                    lastAsaasSyncAt: true,
                    createdAt: true,
                    updatedAt: true,
                    requirements: {
                      select: {
                        id: true,
                        groupId: true,
                        type: true,
                        title: true,
                        description: true,
                        submissionMethod: true,
                        status: true,
                        responsibleName: true,
                        responsibleType: true,
                        createdAt: true,
                        updatedAt: true,
                        slots: {
                          select: {
                            id: true,
                            slotId: true,
                            status: true,
                            uiLabel: true,
                            createdAt: true,
                            updatedAt: true,
                          },
                        },
                      },
                      orderBy: { updatedAt: 'desc' },
                    },
                  },
                },
                statusHistory: {
                  select: {
                    id: true,
                    oldStatus: true,
                    newStatus: true,
                    event: true,
                    payloadId: true,
                    createdAt: true,
                  },
                  take: 10,
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
      },
    }),
    Promise.all([
      prisma.usuarioConta.count({ where: { contaId } }),
      prisma.aluno.count({ where: { contaId, status: 'ATIVO' } }),
      prisma.responsavel.count({ where: { contaId } }),
      prisma.matricula.count({ where: { contaId, status: 'ATIVA' } }),
      prisma.cobranca.count({ where: { contaId } }),
      prisma.cobranca.count({
        where: {
          contaId,
          status: { in: ['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'ATRASADO', 'CANCELAMENTO_PENDENTE'] },
        },
      }),
      prisma.chargeReadModel.count({
        where: { contaId, NOT: { sourceKind: 'COBRANCA' } },
      }),
      prisma.chargeReadModel.count({
        where: {
          contaId,
          NOT: { sourceKind: 'COBRANCA' },
          status: { in: ['PENDING', 'PENDENTE', 'OVERDUE', 'ATRASADO'] },
        },
      }),
      prisma.webhookAsaas.count({
        where: { contaId, status: { in: ['ERRO', 'FAILED', 'ERROR'] } },
      }),
    ]),
    prisma.webhookAsaas.findMany({
      where: { contaId },
      select: {
        id: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
        processadoEm: true,
        ultimoErro: true,
      },
      take: 6,
      orderBy: { recebidoEm: 'desc' },
    }),
  ]);

  const [
    usuarios,
    alunos,
    responsaveis,
    matriculasAtivas,
    totalCobrancasLocais,
    cobrancasAbertasLocais,
    totalCobrancasReadModel,
    cobrancasAbertasReadModel,
    webhooksComErro,
  ] = counts;

  return conta
    ? {
        conta,
        counts: {
          usuarios,
          alunos,
          responsaveis,
          matriculasAtivas,
          totalCobrancas: totalCobrancasLocais + totalCobrancasReadModel,
          cobrancasAbertas: cobrancasAbertasLocais + cobrancasAbertasReadModel,
          webhooksComErro,
        },
        recentWebhooks,
      }
    : null;
}

export async function listSupportAccountFinance(contaId?: string) {
  const [readModels, cobrancas] = await Promise.all([
    prisma.chargeReadModel.findMany({
      where: contaId ? { contaId } : undefined,
      select: {
        id: true,
        contaId: true,
        payerName: true,
        description: true,
        sourceKind: true,
        sourceId: true,
        origin: true,
        chargeType: true,
        status: true,
        value: true,
        dueDate: true,
        billingType: true,
        asaasPaymentId: true,
        matriculaId: true,
        alunoId: true,
        updatedAt: true,
        conta: { select: { nome: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.cobranca.findMany({
      where: contaId ? { contaId } : undefined,
      select: {
        id: true,
        contaId: true,
        tipo: true,
        descricao: true,
        valor: true,
        vencimento: true,
        formaPagamento: true,
        status: true,
        asaasPaymentId: true,
        matriculaId: true,
        createdAt: true,
        updatedAt: true,
        conta: { select: { nome: true } },
        matricula: {
          select: {
            aluno: { select: { id: true, nome: true } },
            responsavelFinanceiro: { select: { nome: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const projectedCobrancaIds = new Set(
    readModels
      .filter((charge) => charge.sourceKind === 'COBRANCA')
      .map((charge) => charge.sourceId),
  );

  const fallbackCharges = cobrancas
    .filter((charge) => !projectedCobrancaIds.has(charge.id))
    .map((charge) => {
      const chargeType = String(charge.tipo);

      return {
        id: charge.id,
        contaId: charge.contaId,
        payerName: charge.matricula.responsavelFinanceiro?.nome ?? charge.matricula.aluno.nome,
        description: charge.descricao ?? chargeType,
        sourceKind: 'COBRANCA',
        sourceId: charge.id,
        origin: 'ACADEMIC',
        chargeType:
          chargeType === 'PARCELADA'
            ? 'INSTALLMENT'
            : chargeType === 'RECORRENTE'
              ? 'SUBSCRIPTION'
              : 'ONE_TIME',
        status: String(charge.status),
        value: charge.valor,
        dueDate: charge.vencimento,
        billingType: String(charge.formaPagamento),
        asaasPaymentId: charge.asaasPaymentId,
        matriculaId: charge.matriculaId,
        alunoId: charge.matricula.aluno.id,
        createdAt: charge.createdAt,
        updatedAt: charge.updatedAt,
        conta: charge.conta,
      };
    });

  return [...readModels, ...fallbackCharges].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
}

export async function listSupportWebhooks(contaId?: string) {
  return prisma.webhookAsaas.findMany({
    where: contaId ? { contaId } : undefined,
    select: {
      id: true,
      contaId: true,
      evento: true,
      eventId: true,
      status: true,
      recebidoEm: true,
      processadoEm: true,
      tentativas: true,
      ultimoErro: true,
      asaasPaymentId: true,
      asaasSubscriptionId: true,
      asaasTransferId: true,
      conta: { select: { nome: true } },
    },
    take: 50,
    orderBy: { recebidoEm: 'desc' },
  });
}

export async function listSupportWebhooksPage(options: {
  contaId?: string;
  page?: number;
  pageSize?: number;
  filters?: SupportWebhookFilters;
} = {}): Promise<SupportWebhookPage> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, options.pageSize ?? SUPPORT_WEBHOOK_PAGE_SIZE));
  const filters = options.filters ?? {};
  const unified = unifiedWebhookSql(options.contaId, filters);

  type RawWebhookRow = Omit<SupportWebhookListItem, 'conta'> & { contaNome: string };
  type RawCountRow = { count: number | bigint };

  const countRows = await prisma.$queryRaw<RawCountRow[]>(Prisma.sql`
    SELECT COUNT(*)::int AS "count"
    FROM (${unified}) AS "unifiedWebhooks"
  `);
  const total = Number(countRows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Math.min(page, totalPages);
  const rows = await prisma.$queryRaw<RawWebhookRow[]>(Prisma.sql`
    SELECT *
    FROM (${unified}) AS "unifiedWebhooks"
    ORDER BY "recebidoEm" DESC, "id" DESC
    LIMIT ${pageSize} OFFSET ${(normalizedPage - 1) * pageSize}
  `);
  const items = rows.map(({ contaNome, ...row }) => ({
    ...row,
    conta: { nome: contaNome },
  }));

  return {
    items,
    total,
    page: normalizedPage,
    pageSize,
    totalPages,
  };
}

export async function getSupportWebhookFilterOptions(contaId?: string) {
  const [acceptedEvents, rejectedEvents, statuses] = await Promise.all([
    prisma.webhookAsaas.findMany({
      where: contaId ? { contaId } : undefined,
      select: { evento: true },
      distinct: ['evento'],
      orderBy: { evento: 'asc' },
    }),
    prisma.webhookAsaasRejection.findMany({
      where: contaId ? { contaId } : undefined,
      select: { evento: true },
      distinct: ['evento'],
      orderBy: { evento: 'asc' },
    }),
    prisma.webhookAsaas.findMany({
      where: contaId ? { contaId } : undefined,
      select: { status: true },
      distinct: ['status'],
      orderBy: { status: 'asc' },
    }),
  ]);

  return {
    events: Array.from(new Set([...acceptedEvents, ...rejectedEvents].map((item) => item.evento).filter(Boolean))).sort() as string[],
    statuses: Array.from(new Set([...statuses.map((item) => item.status), 'REJEITADO'])).sort(),
  };
}

export async function getSupportWebhookHealth(): Promise<SupportWebhookHealth> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalReceived, processedLast24h, pending, errored, exhausted, rejectedLast24h, lastReceived, lastError, lastRejection, accounts] = await Promise.all([
    prisma.webhookAsaas.count(),
    prisma.webhookAsaas.count({ where: { status: 'PROCESSADO', processadoEm: { gte: since24h } } }),
    prisma.webhookAsaas.count({ where: { status: { in: ['PENDENTE', 'PROCESSANDO'] } } }),
    prisma.webhookAsaas.count({ where: { status: { in: ['ERRO', 'ERROR', 'FAILED'] } } }),
    prisma.webhookAsaas.count({ where: { status: 'EXAURIDO' } }),
    prisma.webhookAsaasRejection.count({ where: { recebidoEm: { gte: since24h } } }),
    prisma.webhookAsaas.findFirst({ select: { recebidoEm: true }, orderBy: { recebidoEm: 'desc' } }),
    prisma.webhookAsaas.findFirst({ where: { ultimoErro: { not: null } }, select: { recebidoEm: true, ultimoErro: true }, orderBy: { recebidoEm: 'desc' } }),
    prisma.webhookAsaasRejection.findFirst({ where: { recebidoEm: { gte: since24h } }, select: { recebidoEm: true, reason: true }, orderBy: { recebidoEm: 'desc' } }),
    prisma.asaasAccount.findMany({ select: { webhookStatus: true, lastWebhookCheckAt: true } }),
  ]);

  const lastErrorCandidate = [
    lastError ? { at: lastError.recebidoEm, message: lastError.ultimoErro ?? 'Falha de processamento' } : null,
    lastRejection ? { at: lastRejection.recebidoEm, message: lastRejection.reason } : null,
  ].filter((item): item is { at: Date; message: string } => Boolean(item)).sort((left, right) => right.at.getTime() - left.at.getTime())[0] ?? null;
  const accountsNeedingAttention = accounts.filter((account) => account.webhookStatus !== 'ACTIVE').length;
  const status = exhausted > 0 ? 'ERROR' : pending > 0 || errored > 0 || rejectedLast24h > 0 || accountsNeedingAttention > 0 ? 'WARNING' : 'OK';
  const lastWebhookCheckAt = accounts.map((account) => account.lastWebhookCheckAt).filter(Boolean).sort((left, right) => right!.getTime() - left!.getTime())[0] ?? null;

  return {
    status,
    statusLabel: status === 'OK' ? 'Operando normalmente' : status === 'ERROR' ? 'Ação necessária' : 'Atenção necessária',
    totalReceived,
    processedLast24h,
    pending,
    errored,
    exhausted,
    rejectedLast24h,
    accountsNeedingAttention,
    lastReceivedAt: lastReceived?.recebidoEm ?? null,
    lastErrorAt: lastErrorCandidate?.at ?? null,
    lastError: lastErrorCandidate?.message ?? null,
    lastWebhookCheckAt,
  };
}

export async function getSupportWebhookRejectionDetail(rejectionId: string) {
  return prisma.webhookAsaasRejection.findUnique({
    where: { id: rejectionId },
    select: {
      id: true,
      contaId: true,
      evento: true,
      eventId: true,
      reason: true,
      recebidoEm: true,
      payload: true,
    },
  });
}

export async function listSupportAudit(contaId?: string) {
  const supportLogs = await prisma.supportAuditLog.findMany({
    where: contaId ? { contaId } : undefined,
    select: {
      id: true,
      contaId: true,
      actorRole: true,
      actorUsername: true,
      action: true,
      entityType: true,
      entityId: true,
      reason: true,
      correlationId: true,
      createdAt: true,
    },
    take: 50,
    orderBy: { createdAt: 'desc' },
  });

  const contaIds = Array.from(new Set(supportLogs.map((item) => item.contaId).filter(Boolean))) as string[];
  const contas = await prisma.conta.findMany({
    where: { id: { in: contaIds } },
    select: { id: true, nome: true },
  });
  const names = new Map(contas.map((item) => [item.id, item.nome]));

  return supportLogs.map((item) => ({
    ...item,
    actorType: item.actorRole ?? 'SUPPORT',
    actorId: item.actorUsername ?? null,
    conta: { nome: item.contaId ? names.get(item.contaId) ?? item.contaId : 'Sem conta' },
  }));
}

export async function getSupportWebhookAdvanced(contaId?: string) {
  const where = contaId ? { contaId } : undefined;
  const [active, archived, rejected] = await Promise.all([
    prisma.webhookAsaas.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
        ultimoErro: true,
        conta: { select: { nome: true } },
      },
      take: 30,
      orderBy: { recebidoEm: 'desc' },
    }),
    prisma.webhookAsaasArchive.findMany({
      where,
      select: {
        id: true,
        contaId: true,
        evento: true,
        eventId: true,
        status: true,
        recebidoEm: true,
        archivedAt: true,
        conta: { select: { nome: true } },
      },
      take: 20,
      orderBy: { archivedAt: 'desc' },
    }),
    prisma.webhookAsaasRejection.findMany({
      where: contaId ? { contaId } : undefined,
      select: {
        id: true,
        contaId: true,
        evento: true,
        eventId: true,
        reason: true,
        recebidoEm: true,
      },
      take: 20,
      orderBy: { recebidoEm: 'desc' },
    }),
  ]);

  return { active, archived, rejected };
}
