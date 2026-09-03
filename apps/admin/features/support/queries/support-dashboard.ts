import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { normalizeSearch } from '../shared/format';

const SEARCH_LIMIT = 8;

export type SupportSearchResult = {
  type:
    | 'Conta'
    | 'Usuário'
    | 'Aluno'
    | 'Responsável'
    | 'Matrícula'
    | 'Cobrança'
    | 'Assinatura'
    | 'Parcelamento'
    | 'Transferência'
    | 'Rematrícula'
    | 'Webhook';
  title: string;
  description: string;
  href: string;
  contaId: string;
  meta?: string;
};

export async function getSupportOverview() {
  return getSupportOverviewUncached();
}

async function withPerfTimer<T>(_area: string, _resource: string, load: () => Promise<T>) {
  return load();
}

async function getSupportOverviewUncached() {
  const periodStart = monthStartUtc();
  const periodEnd = nextMonthStartUtc();
  const [
    contasAtivas,
    contasInativas,
    assinaturasEmAtraso,
    cancelamentosNoMes,
    receitaMensal,
  ] = await Promise.all([
    prisma.conta.count({ where: { status: 'ATIVO', deletedAt: null } }),
    prisma.conta.count({ where: { status: 'INATIVO', deletedAt: null } }),
    prisma.platformBillingAccount.count({
      where: {
        environment: 'LIVE',
        status: { in: ['PAST_DUE', 'UNPAID'] },
        conta: { status: 'ATIVO', deletedAt: null },
      },
    }),
    prisma.platformBillingAccount.count({
      where: {
        environment: 'LIVE',
        canceledAt: { gte: periodStart, lt: periodEnd },
      },
    }),
    prisma.platformBillingInvoice.aggregate({
      where: {
        environment: 'LIVE',
        status: 'PAID',
        currency: { in: ['brl', 'BRL'] },
        paidAt: {
          gte: periodStart,
          lt: periodEnd,
        },
      },
      _sum: { amountPaid: true },
    }),
  ]);

  return {
    contasAtivas,
    contasInativas,
    assinaturasEmAtraso,
    cancelamentosNoMes,
    receitaMensalCents: receitaMensal._sum.amountPaid ?? 0,
  };
}

function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function nextMonthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export async function searchSupport(query: string): Promise<SupportSearchResult[]> {
  const q = normalizeSearch(query);
  if (q.length < 2) return [];

  const contains = { contains: q, mode: Prisma.QueryMode.insensitive };
  const digits = q.replace(/\D/g, '');
  const looksExactId = /^(c[klmnpqrstuvwxyz0-9]{8,}|pay_|sub_|ins_|tr_|evt_|asaas_|acc_|cus_)/i.test(q);

  const [
    contas,
    usuarios,
    alunos,
    responsaveis,
    matriculas,
    cobrancas,
    subscriptions,
    standaloneSubscriptions,
    installmentPlans,
    standaloneInstallments,
    transfers,
    rematriculas,
    webhooks,
  ] = await Promise.all([
      withPerfTimer('support.search', 'contas', () =>
      prisma.conta.findMany({
        where: {
          deletedAt: null,
          OR: [
            { id: q },
            { nome: contains },
            ...(digits.length >= 3 ? [{ cpfCnpj: { contains: digits } }] : []),
          ],
        },
        select: { id: true, nome: true, status: true, financeStatus: true },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'usuarios', () =>
      prisma.usuario.findMany({
        where: {
          OR: looksExactId ? [{ id: q }] : [{ id: q }, { nome: contains }, { email: contains }],
        },
        select: { id: true, contaId: true, nome: true, email: true, role: true, status: true },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'alunos', () =>
      prisma.aluno.findMany({
        where: {
          OR: looksExactId ? [
            { id: q },
            { asaasCustomerId: q },
            { asaasCustomerExternalReference: q },
          ] : [
            { id: q },
            { nome: contains },
            { email: contains },
            { codigoInterno: contains },
            { asaasCustomerId: q },
            { asaasCustomerExternalReference: q },
            ...(digits.length >= 3 ? [{ cpf: { contains: digits } }] : []),
          ],
        },
        select: { id: true, contaId: true, nome: true, email: true, status: true },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'responsaveis', () =>
      prisma.responsavel.findMany({
        where: {
          OR: looksExactId ? [
            { id: q },
            { asaasCustomerId: q },
            { asaasCustomerExternalReference: q },
          ] : [
            { id: q },
            { nome: contains },
            { email: contains },
            { asaasCustomerId: q },
            { asaasCustomerExternalReference: q },
            ...(digits.length >= 3 ? [{ cpf: { contains: digits } }] : []),
          ],
        },
        select: { id: true, contaId: true, nome: true, email: true, financeiro: true },
        take: SEARCH_LIMIT,
      })),
      withPerfTimer('support.search', 'matriculas', () =>
      prisma.matricula.findMany({
        where: {
          OR: [{ id: q }, { asaasId: q }, { asaasSubscriptionId: q }],
        },
        select: {
          id: true,
          contaId: true,
          status: true,
          statusFinanceiro: true,
          aluno: { select: { nome: true } },
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'cobrancas', () =>
      prisma.chargeReadModel.findMany({
        where: {
          OR: looksExactId ? [
            { id: q },
            { sourceId: q },
            { asaasPaymentId: q },
            { matriculaId: q },
            { groupId: q },
          ] : [
            { id: q },
            { sourceId: q },
            { payerName: contains },
            { asaasPaymentId: q },
            { matriculaId: q },
            { groupId: q },
          ],
        },
        select: {
          id: true,
          contaId: true,
          payerName: true,
          status: true,
          value: true,
          asaasPaymentId: true,
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'subscriptions', () =>
      prisma.subscription.findMany({
        where: {
          OR: [{ id: q }, { externalReference: q }, { asaasSubscriptionId: q }, { matriculaId: q }],
        },
        select: {
          id: true,
          contaId: true,
          status: true,
          externalReference: true,
          asaasSubscriptionId: true,
          matricula: { select: { aluno: { select: { nome: true } } } },
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'standaloneSubscriptions', () =>
      prisma.standaloneSubscription.findMany({
        where: {
          OR: [{ id: q }, { externalReference: q }, { asaasSubscriptionId: q }, { idempotencyKey: q }],
        },
        select: {
          id: true,
          contaId: true,
          status: true,
          externalReference: true,
          asaasSubscriptionId: true,
          value: true,
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'installmentPlans', () =>
      prisma.installmentPlan.findMany({
        where: {
          OR: [{ id: q }, { externalReference: q }, { asaasInstallmentId: q }, { matriculaId: q }],
        },
        select: {
          id: true,
          contaId: true,
          status: true,
          externalReference: true,
          asaasInstallmentId: true,
          matricula: { select: { aluno: { select: { nome: true } } } },
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'standaloneInstallments', () =>
      prisma.standaloneInstallmentPlan.findMany({
        where: {
          OR: [{ id: q }, { externalReference: q }, { asaasInstallmentId: q }, { idempotencyKey: q }],
        },
        select: {
          id: true,
          contaId: true,
          status: true,
          externalReference: true,
          asaasInstallmentId: true,
          value: true,
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'transfers', () =>
      prisma.transferRequest.findMany({
        where: {
          OR: [{ id: q }, { externalReference: q }, { asaasTransferId: q }, { idempotencyKey: q }],
        },
        select: {
          id: true,
          contaId: true,
          status: true,
          externalReference: true,
          asaasTransferId: true,
          value: true,
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'rematriculas', () =>
      prisma.rematriculaProcesso.findMany({
        where: {
          OR: [
            { id: q },
            { idempotencyKey: q },
            { externalReference: q },
            { holderId: q },
            { itens: { some: { OR: [{ matriculaOrigemId: q }, { matriculaFuturaId: q }] } } },
          ],
        },
        select: {
          id: true,
          contaId: true,
          externalReference: true,
          status: true,
          origin: true,
          targetPeriodId: true,
          holderType: true,
          holderId: true,
        },
        take: SEARCH_LIMIT,
        orderBy: { updatedAt: 'desc' },
      })),
      withPerfTimer('support.search', 'webhooks', () =>
      prisma.webhookAsaas.findMany({
        where: {
          OR: [
            { id: q },
            { eventId: q },
            { asaasPaymentId: q },
            { asaasSubscriptionId: q },
            { asaasTransferId: q },
            { evento: contains },
          ],
        },
        select: { id: true, contaId: true, evento: true, status: true, eventId: true },
        take: SEARCH_LIMIT,
        orderBy: { recebidoEm: 'desc' },
      })),
    ]);

  return [
    ...contas.map((item) => ({
      type: 'Conta' as const,
      title: item.nome,
      description: `contaId ${item.id}`,
      href: `/contas/${item.id}`,
      contaId: item.id,
      meta: `${item.status} · ${item.financeStatus}`,
    })),
    ...usuarios.map((item) => ({
      type: 'Usuário' as const,
      title: item.nome,
      description: item.email,
      href: `/contas/${item.contaId}/usuarios/${item.id}`,
      contaId: item.contaId,
      meta: `${item.role} · ${item.status}`,
    })),
    ...alunos.map((item) => ({
      type: 'Aluno' as const,
      title: item.nome,
      description: item.email ?? 'Sem e-mail',
      href: `/contas/${item.contaId}/alunos/${item.id}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...responsaveis.map((item) => ({
      type: 'Responsável' as const,
      title: item.nome,
      description: item.email,
      href: `/contas/${item.contaId}/responsaveis/${item.id}`,
      contaId: item.contaId,
      meta: item.financeiro ? 'Financeiro' : 'Contato',
    })),
    ...matriculas.map((item) => ({
      type: 'Matrícula' as const,
      title: item.aluno.nome,
      description: `matriculaId ${item.id}`,
      href: `/contas/${item.contaId}/matriculas/${item.id}`,
      contaId: item.contaId,
      meta: `${item.status} · ${item.statusFinanceiro}`,
    })),
    ...cobrancas.map((item) => ({
      type: 'Cobrança' as const,
      title: item.payerName,
      description: item.asaasPaymentId ? `Asaas ${item.asaasPaymentId}` : `cobranca ${item.id}`,
      href: `/contas/${item.contaId}/financeiro/cobrancas/${item.id}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...subscriptions.map((item) => ({
      type: 'Assinatura' as const,
      title: item.matricula.aluno.nome,
      description: item.asaasSubscriptionId ?? item.externalReference,
      href: `/contas/${item.contaId}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...standaloneSubscriptions.map((item) => ({
      type: 'Assinatura' as const,
      title: item.externalReference,
      description: item.asaasSubscriptionId ?? `assinatura ${item.id}`,
      href: `/contas/${item.contaId}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...installmentPlans.map((item) => ({
      type: 'Parcelamento' as const,
      title: item.matricula.aluno.nome,
      description: item.asaasInstallmentId ?? item.externalReference,
      href: `/contas/${item.contaId}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...standaloneInstallments.map((item) => ({
      type: 'Parcelamento' as const,
      title: item.externalReference,
      description: item.asaasInstallmentId ?? `parcelamento ${item.id}`,
      href: `/contas/${item.contaId}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...transfers.map((item) => ({
      type: 'Transferência' as const,
      title: item.externalReference,
      description: item.asaasTransferId ?? `transfer ${item.id}`,
      href: `/contas/${item.contaId}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...rematriculas.map((item) => ({
      type: 'Rematrícula' as const,
      title: item.externalReference ?? item.id,
      description: `${item.origin} · período ${item.targetPeriodId} · ${item.holderType}:${item.holderId}`,
      href: `/contas/${item.contaId}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...webhooks.map((item) => ({
      type: 'Webhook' as const,
      title: item.evento,
      description: item.eventId ?? item.id,
      href: `/contas/${item.contaId}/webhooks/${item.id}`,
      contaId: item.contaId,
      meta: item.status,
    })),
  ];
}

function supportAccountsWhere(query: string): Prisma.ContaWhereInput {
  const q = normalizeSearch(query);
  const digits = q.replace(/\D/g, '');

  return q
    ? {
        deletedAt: null,
        OR: [
          { id: q },
          { nome: { contains: q, mode: Prisma.QueryMode.insensitive } },
          {
            usuarios: {
              some: {
                OR: [
                  { nome: { contains: q, mode: Prisma.QueryMode.insensitive } },
                  { email: { contains: q, mode: Prisma.QueryMode.insensitive } },
                ],
              },
            },
          },
          {
            alunos: {
              some: {
                nome: { contains: q, mode: Prisma.QueryMode.insensitive },
              },
            },
          },
          {
            responsaveis: {
              some: {
                OR: [
                  { nome: { contains: q, mode: Prisma.QueryMode.insensitive } },
                  { email: { contains: q, mode: Prisma.QueryMode.insensitive } },
                ],
              },
            },
          },
          {
            professores: {
              some: {
                OR: [
                  { nome: { contains: q, mode: Prisma.QueryMode.insensitive } },
                  { email: { contains: q, mode: Prisma.QueryMode.insensitive } },
                ],
              },
            },
          },
          {
            colaboradores: {
              some: {
                OR: [
                  { nome: { contains: q, mode: Prisma.QueryMode.insensitive } },
                  { email: { contains: q, mode: Prisma.QueryMode.insensitive } },
                ],
              },
            },
          },
          ...(digits.length >= 3
            ? [
                { cpfCnpj: { contains: digits } },
                { alunos: { some: { cpf: { contains: digits } } } },
                { responsaveis: { some: { cpf: { contains: digits } } } },
                { professores: { some: { cpf: { contains: digits } } } },
                { colaboradores: { some: { cpf: { contains: digits } } } },
              ]
            : []),
        ],
      }
    : { deletedAt: null };
}

const supportAccountSelect = {
  id: true,
  nome: true,
  status: true,
  financeStatus: true,
  externalAsaasOnboardingStatus: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      usuariosConta: true,
      alunos: true,
      matriculas: true,
      chargeReadModels: true,
      webhooks: true,
    },
  },
} satisfies Prisma.ContaSelect;

export async function listSupportAccounts(query = '') {
  return prisma.conta.findMany({
    where: supportAccountsWhere(query),
    select: supportAccountSelect,
    take: 40,
    orderBy: { updatedAt: 'desc' },
  });
}

export const SUPPORT_ACCOUNTS_PAGE_SIZE = 20;

export async function listSupportAccountsPage(query = '', requestedPage = 1) {
  const where = supportAccountsWhere(query);
  const total = await prisma.conta.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / SUPPORT_ACCOUNTS_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const accounts = await prisma.conta.findMany({
    where,
    select: supportAccountSelect,
    skip: (page - 1) * SUPPORT_ACCOUNTS_PAGE_SIZE,
    take: SUPPORT_ACCOUNTS_PAGE_SIZE,
    orderBy: { updatedAt: 'desc' },
  });

  return {
    accounts,
    total,
    page,
    pageSize: SUPPORT_ACCOUNTS_PAGE_SIZE,
    totalPages,
  };
}
