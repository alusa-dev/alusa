import { prisma } from '@alusa/database';

import { mapGlobalAdminSearchResultToDTO } from './mappers';

function emptyGroup(key: string, label: string, items: Array<Record<string, unknown>>) {
  return {
    key,
    label,
    total: items.length,
    items,
  };
}

export async function searchGlobalAdmin(query: string) {
  const normalized = query.trim();
  if (!normalized) {
    return mapGlobalAdminSearchResultToDTO({ query: '', groups: [] });
  }

  const numericQuery = normalized.replace(/\D/g, '');
  const tenantWhere: Array<Record<string, unknown>> = [
    { id: { contains: normalized } },
    { nome: { contains: normalized, mode: 'insensitive' as const } },
  ];

  if (numericQuery) {
    tenantWhere.push({ cpfCnpj: { contains: numericQuery } });
  }

  const [tenants, users, charges, matriculas, webhooks, asaasAccounts] = await Promise.all([
    prisma.conta.findMany({
      where: {
        OR: tenantWhere,
      },
      select: { id: true, nome: true },
      take: 5,
      orderBy: { nome: 'asc' },
    }),
    prisma.usuario.findMany({
      where: {
        OR: [
          { id: { contains: normalized } },
          { email: { contains: normalized, mode: 'insensitive' } },
          { nome: { contains: normalized, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        nome: true,
        email: true,
        contaId: true,
        conta: { select: { nome: true } },
      },
      take: 5,
      orderBy: { nome: 'asc' },
    }),
    prisma.cobranca.findMany({
      where: {
        OR: [
          { id: { contains: normalized } },
          { asaasPaymentId: { contains: normalized } },
          { asaasId: { contains: normalized } },
        ],
      },
      select: {
        id: true,
        status: true,
        asaasPaymentId: true,
        matricula: {
          select: {
            aluno: {
              select: {
                nome: true,
                contaId: true,
                conta: { select: { nome: true } },
              },
            },
          },
        },
      },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.matricula.findMany({
      where: {
        OR: [
          { id: { contains: normalized } },
          { asaasSubscriptionId: { contains: normalized } },
          { asaasId: { contains: normalized } },
        ],
      },
      select: {
        id: true,
        status: true,
        aluno: {
          select: {
            nome: true,
            contaId: true,
            conta: { select: { nome: true } },
          },
        },
      },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.webhookAsaas.findMany({
      where: {
        OR: [
          { id: { contains: normalized } },
          { eventId: { contains: normalized } },
          { asaasPaymentId: { contains: normalized } },
          { asaasSubscriptionId: { contains: normalized } },
        ],
      },
      select: {
        id: true,
        evento: true,
        eventId: true,
        contaId: true,
        conta: { select: { nome: true } },
      },
      take: 5,
      orderBy: { recebidoEm: 'desc' },
    }),
    prisma.asaasAccount.findMany({
      where: {
        OR: [
          { id: { contains: normalized } },
          { asaasAccountId: { contains: normalized } },
        ],
      },
      select: {
        id: true,
        asaasAccountId: true,
        financeProfile: {
          select: {
            contaId: true,
            conta: { select: { nome: true } },
          },
        },
      },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return mapGlobalAdminSearchResultToDTO({
    query: normalized,
    groups: [
      emptyGroup(
        'tenants',
        'Contas',
        tenants.map((tenant) => ({
          type: 'tenant',
          id: tenant.id,
          title: tenant.nome,
          subtitle: tenant.id,
          tenantId: tenant.id,
          tenantName: tenant.nome,
          href: `/developer/tenants/${tenant.id}`,
        })),
      ),
      emptyGroup(
        'users',
        'Usuários',
        users.map((user) => ({
          type: 'user',
          id: user.id,
          title: user.nome,
          subtitle: user.email,
          tenantId: user.contaId,
          tenantName: user.conta.nome,
          href: `/developer/users/${user.id}`,
        })),
      ),
      emptyGroup(
        'charges',
        'Cobranças',
        charges.map((charge) => ({
          type: 'charge',
          id: charge.id,
          title: charge.asaasPaymentId ?? charge.id,
          subtitle: `${charge.matricula.aluno.nome} • ${charge.status}`,
          tenantId: charge.matricula.aluno.contaId,
          tenantName: charge.matricula.aluno.conta.nome,
          href: `/developer/tenants/${charge.matricula.aluno.contaId}?focusCharge=${charge.id}`,
        })),
      ),
      emptyGroup(
        'matriculas',
        'Matrículas',
        matriculas.map((matricula) => ({
          type: 'matricula',
          id: matricula.id,
          title: matricula.id,
          subtitle: `${matricula.aluno.nome} • ${matricula.status}`,
          tenantId: matricula.aluno.contaId,
          tenantName: matricula.aluno.conta.nome,
          href: `/developer/tenants/${matricula.aluno.contaId}?focusMatricula=${matricula.id}`,
        })),
      ),
      emptyGroup(
        'webhooks',
        'Webhooks',
        webhooks.map((webhook) => ({
          type: 'webhook',
          id: webhook.id,
          title: webhook.eventId ?? webhook.id,
          subtitle: webhook.evento,
          tenantId: webhook.contaId,
          tenantName: webhook.conta.nome,
          href: `/developer/tenants/${webhook.contaId}?focusEvent=${webhook.id}`,
        })),
      ),
      emptyGroup(
        'asaas_accounts',
        'Subcontas Asaas',
        asaasAccounts.map((account) => ({
          type: 'asaas_account',
          id: account.id,
          title: account.asaasAccountId ?? account.id,
          subtitle: account.financeProfile.conta.nome,
          tenantId: account.financeProfile.contaId,
          tenantName: account.financeProfile.conta.nome,
          href: `/developer/tenants/${account.financeProfile.contaId}`,
        })),
      ),
    ].filter((group) => group.total > 0),
  });
}
