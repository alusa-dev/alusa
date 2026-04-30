import { prisma } from '@alusa/database';

import { mapGlobalAdminDashboardToDTO } from './mappers';

const REMOTE_PAID_STATUSES = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
const LOCAL_FINAL_STATUSES = ['PAGO', 'CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL'];

function getWindowStart(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

type TenantAggregate = {
  tenantId: string;
  tenantName: string;
  backlog: number;
  errored: number;
  rejected: number;
  financialDrift: number;
  missingWebhookHash: boolean;
  categories: Set<string>;
};

function ensureAggregate(
  map: Map<string, TenantAggregate>,
  tenant: { tenantId: string; tenantName: string; missingWebhookHash?: boolean },
) {
  const current = map.get(tenant.tenantId);
  if (current) {
    if (tenant.missingWebhookHash) current.missingWebhookHash = true;
    return current;
  }

  const created: TenantAggregate = {
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
    backlog: 0,
    errored: 0,
    rejected: 0,
    financialDrift: 0,
    missingWebhookHash: Boolean(tenant.missingWebhookHash),
    categories: new Set<string>(),
  };
  map.set(tenant.tenantId, created);
  return created;
}

function buildSeverity(item: TenantAggregate) {
  if (item.missingWebhookHash || item.rejected > 0 || item.errored > 0) return 'critical' as const;
  if (item.financialDrift > 0 || item.backlog > 0) return 'warning' as const;
  return 'info' as const;
}

function buildSummary(item: TenantAggregate) {
  const fragments: string[] = [];
  if (item.missingWebhookHash) fragments.push('hash local do webhook ausente');
  if (item.rejected > 0) fragments.push(`${item.rejected} rejeição(ões) recentes`);
  if (item.errored > 0) fragments.push(`${item.errored} webhook(s) com erro`);
  if (item.backlog > 0) fragments.push(`backlog ${item.backlog}`);
  if (item.financialDrift > 0) fragments.push(`${item.financialDrift} divergência(s) financeira(s)`);
  return fragments.join(' • ') || 'Sem anomalias relevantes';
}

export async function getGlobalAdminDashboard(windowDays = 7) {
  const windowStart = getWindowStart(Math.max(1, Math.min(30, windowDays)));

  const [
    tenants,
    webhookGroups,
    rejections,
    divergentCharges,
    activeUsers,
    activeAccounts,
    cancelledAccounts,
    cancelledInWindow,
    pendingAccessUsers,
    recentUsersInWindow,
    requestErrorsInWindow,
    recentCancellations,
    recentUsers,
  ] = await Promise.all([
    prisma.conta.findMany({
      where: {
        deletedAt: null,
        financeProfile: { isNot: null },
      },
      select: {
        id: true,
        nome: true,
        financeProfile: {
          select: {
            asaasAccount: {
              select: {
                webhookAuthTokenHash: true,
              },
            },
          },
        },
      },
      orderBy: { nome: 'asc' },
    }),
    prisma.webhookAsaas.groupBy({
      by: ['contaId', 'status'],
      where: {
        recebidoEm: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    prisma.webhookAsaasRejection.groupBy({
      by: ['contaId'],
      where: {
        contaId: { not: null },
        recebidoEm: { gte: windowStart },
      },
      _count: { _all: true },
    }),
    prisma.cobranca.findMany({
      where: {
        matricula: {
          aluno: {
            conta: { deletedAt: null },
          },
        },
        OR: [
          {
            status: { notIn: LOCAL_FINAL_STATUSES as never[] },
            asaasStatus: { in: REMOTE_PAID_STATUSES },
          },
          {
            status: 'PAGO',
            asaasStatus: { in: ['PENDING', 'OVERDUE', 'DELETED'] },
          },
        ],
      },
      select: {
        id: true,
        matricula: {
          select: {
            aluno: {
              select: {
                contaId: true,
                conta: {
                  select: { nome: true },
                },
              },
            },
          },
        },
      },
      take: 500,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.usuario.count({
      where: {
        status: 'ATIVO',
        conta: { deletedAt: null },
      },
    }),
    prisma.conta.count({
      where: {
        deletedAt: null,
        status: 'ATIVO',
      },
    }),
    prisma.conta.count({
      where: {
        deletedAt: { not: null },
      },
    }),
    prisma.conta.count({
      where: {
        deletedAt: { gte: windowStart },
      },
    }),
    prisma.usuario.count({
      where: {
        status: 'ATIVO',
        emailVerifiedAt: null,
        conta: { deletedAt: null },
      },
    }),
    prisma.usuario.count({
      where: {
        createdAt: { gte: windowStart },
        conta: { deletedAt: null },
      },
    }),
    prisma.logIntegracao.count({
      where: {
        createdAt: { gte: windowStart },
        status: 'ERROR',
      },
    }),
    prisma.conta.findMany({
      where: {
        deletedAt: { gte: windowStart },
      },
      orderBy: { deletedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        nome: true,
        deletedAt: true,
        deleteReason: true,
      },
    }),
    prisma.usuario.findMany({
      where: {
        conta: { deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        nome: true,
        email: true,
        createdAt: true,
        contaId: true,
        conta: { select: { nome: true } },
      },
    }),
  ]);

  const aggregateMap = new Map<string, TenantAggregate>();

  for (const tenant of tenants) {
    const aggregate = ensureAggregate(aggregateMap, {
      tenantId: tenant.id,
      tenantName: tenant.nome,
      missingWebhookHash: !tenant.financeProfile?.asaasAccount?.webhookAuthTokenHash,
    });
    if (aggregate.missingWebhookHash) {
      aggregate.categories.add('webhook');
    }
  }

  for (const row of webhookGroups) {
    const aggregate = aggregateMap.get(row.contaId);
    if (!aggregate) continue;

    const count = row._count._all;
    if (row.status === 'PENDENTE' || row.status === 'PROCESSANDO' || row.status === 'ERRO' || row.status === 'EXAURIDO') {
      aggregate.backlog += count;
    }
    if (row.status === 'ERRO' || row.status === 'EXAURIDO') {
      aggregate.errored += count;
      aggregate.categories.add('queue');
      aggregate.categories.add('webhook');
    }
  }

  for (const row of rejections) {
    if (!row.contaId) continue;
    const aggregate = aggregateMap.get(row.contaId);
    if (!aggregate) continue;
    aggregate.rejected = row._count._all;
    if (aggregate.rejected > 0) {
      aggregate.categories.add('webhook');
    }
  }

  for (const charge of divergentCharges) {
    const tenantId = charge.matricula.aluno.contaId;
    const tenantName = charge.matricula.aluno.conta.nome;
    const aggregate = ensureAggregate(aggregateMap, { tenantId, tenantName });
    aggregate.financialDrift += 1;
    aggregate.categories.add('finance');
  }

  const incidents = [...aggregateMap.values()]
    .filter((item) => item.categories.size > 0)
    .sort((left, right) => {
      const leftWeight = left.errored * 5 + left.rejected * 5 + left.financialDrift * 3 + left.backlog;
      const rightWeight = right.errored * 5 + right.rejected * 5 + right.financialDrift * 3 + right.backlog;
      return rightWeight - leftWeight;
    })
    .slice(0, 12)
    .map((item) => ({
      tenantId: item.tenantId,
      tenantName: item.tenantName,
      severity: buildSeverity(item),
      categories: [...item.categories],
      summary: buildSummary(item),
      href: `/developer/tenants/${item.tenantId}`,
      metrics: {
        backlog: item.backlog,
        errored: item.errored,
        rejected: item.rejected,
        financialDrift: item.financialDrift,
      },
    }));

  const distinctWithWebhookIssues = [...aggregateMap.values()].filter(
    (item) => item.missingWebhookHash || item.rejected > 0 || item.errored > 0,
  ).length;
  const distinctQueueErrors = [...aggregateMap.values()].filter((item) => item.errored > 0).length;
  const globalBacklog = [...aggregateMap.values()].reduce((sum, item) => sum + item.backlog, 0);
  const totalFinancialDivergences = [...aggregateMap.values()].reduce(
    (sum, item) => sum + item.financialDrift,
    0,
  );

  return mapGlobalAdminDashboardToDTO({
    generatedAt: new Date().toISOString(),
    summary: {
      activeIncidents: incidents.length,
      tenantsWithBadWebhook: distinctWithWebhookIssues,
      queuesWithError: distinctQueueErrors,
      globalBacklog,
      financialDivergences: totalFinancialDivergences,
    },
    business: {
      activeUsers,
      activeAccounts,
      cancelledAccounts,
      cancelledInWindow,
      pendingAccessUsers,
      recentUsersInWindow,
      requestErrorsInWindow,
    },
    recentCancellations: recentCancellations.map((tenant) => ({
      tenantId: tenant.id,
      tenantName: tenant.nome,
      cancelledAt: tenant.deletedAt?.toISOString() ?? new Date().toISOString(),
      reason: tenant.deleteReason ?? null,
    })),
    recentUsers: recentUsers.map((user) => ({
      userId: user.id,
      nome: user.nome,
      email: user.email,
      tenantId: user.contaId,
      tenantName: user.conta.nome,
      createdAt: user.createdAt.toISOString(),
      href: `/developer/users/${user.id}`,
    })),
    incidents,
  });
}
