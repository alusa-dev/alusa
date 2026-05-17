import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { buildGlobalCacheKey, withTenantCache } from '@/lib/cache/tenant-cache';
import { getTenantCacheAdapter } from '@/lib/cache/server-cache';
import { withPerfTimer } from '@/lib/perf-logger';
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
  if (process.env.SUPPORT_CACHE_ENABLED === 'true') {
    return withTenantCache({
      adapter: getTenantCacheAdapter(),
      key: buildGlobalCacheKey({ area: 'support', resource: 'overview', version: 1 }),
      ttlSeconds: 60,
      staleWhileRevalidateSeconds: 60,
      lockTtlSeconds: 10,
      load: getSupportOverviewUncached,
    }).then((result) => result.body);
  }

  return getSupportOverviewUncached();
}

async function getSupportOverviewUncached() {
  const [
    contasAtivas,
    usuariosAtivos,
    alunosAtivos,
    matriculasAtivas,
    cobrancasAbertas,
    webhooksComErro,
  ] = await Promise.all([
    prisma.conta.count({ where: { status: 'ATIVO', deletedAt: null } }),
    prisma.usuario.count({ where: { status: 'ATIVO' } }),
    prisma.aluno.count({ where: { status: 'ATIVO' } }),
    prisma.matricula.count({ where: { status: 'ATIVA' } }),
    prisma.chargeReadModel.count({
      where: { status: { in: ['PENDING', 'OVERDUE', 'PENDENTE', 'ATRASADO'] } },
    }),
    prisma.webhookAsaas.count({ where: { status: { in: ['ERRO', 'FAILED', 'ERROR'] } } }),
  ]);

  return {
    contasAtivas,
    usuariosAtivos,
    alunosAtivos,
    matriculasAtivas,
    cobrancasAbertas,
    webhooksComErro,
  };
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
      prisma.rematriculaOperacao.findMany({
        where: {
          OR: [
            { id: q },
            { correlationId: q },
            { idempotencyKey: q },
            { oldSubscriptionId: q },
            { newSubscriptionId: q },
            { matriculaOrigemId: q },
            { matriculaNovaId: q },
          ],
        },
        select: {
          id: true,
          contaId: true,
          correlationId: true,
          status: true,
          step: true,
          matriculaOrigemId: true,
          matriculaNovaId: true,
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
      href: `/developer/contas/${item.id}`,
      contaId: item.id,
      meta: `${item.status} · ${item.financeStatus}`,
    })),
    ...usuarios.map((item) => ({
      type: 'Usuário' as const,
      title: item.nome,
      description: item.email,
      href: `/developer/contas/${item.contaId}/usuarios/${item.id}`,
      contaId: item.contaId,
      meta: `${item.role} · ${item.status}`,
    })),
    ...alunos.map((item) => ({
      type: 'Aluno' as const,
      title: item.nome,
      description: item.email ?? 'Sem e-mail',
      href: `/developer/contas/${item.contaId}/alunos/${item.id}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...responsaveis.map((item) => ({
      type: 'Responsável' as const,
      title: item.nome,
      description: item.email,
      href: `/developer/contas/${item.contaId}/responsaveis/${item.id}`,
      contaId: item.contaId,
      meta: item.financeiro ? 'Financeiro' : 'Contato',
    })),
    ...matriculas.map((item) => ({
      type: 'Matrícula' as const,
      title: item.aluno.nome,
      description: `matriculaId ${item.id}`,
      href: `/developer/contas/${item.contaId}/matriculas/${item.id}`,
      contaId: item.contaId,
      meta: `${item.status} · ${item.statusFinanceiro}`,
    })),
    ...cobrancas.map((item) => ({
      type: 'Cobrança' as const,
      title: item.payerName,
      description: item.asaasPaymentId ? `Asaas ${item.asaasPaymentId}` : `cobranca ${item.id}`,
      href: `/developer/contas/${item.contaId}/financeiro/cobrancas/${item.id}`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...subscriptions.map((item) => ({
      type: 'Assinatura' as const,
      title: item.matricula.aluno.nome,
      description: item.asaasSubscriptionId ?? item.externalReference,
      href: `/developer/contas/${item.contaId}/financeiro`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...standaloneSubscriptions.map((item) => ({
      type: 'Assinatura' as const,
      title: item.externalReference,
      description: item.asaasSubscriptionId ?? `assinatura ${item.id}`,
      href: `/developer/contas/${item.contaId}/financeiro`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...installmentPlans.map((item) => ({
      type: 'Parcelamento' as const,
      title: item.matricula.aluno.nome,
      description: item.asaasInstallmentId ?? item.externalReference,
      href: `/developer/contas/${item.contaId}/financeiro`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...standaloneInstallments.map((item) => ({
      type: 'Parcelamento' as const,
      title: item.externalReference,
      description: item.asaasInstallmentId ?? `parcelamento ${item.id}`,
      href: `/developer/contas/${item.contaId}/financeiro`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...transfers.map((item) => ({
      type: 'Transferência' as const,
      title: item.externalReference,
      description: item.asaasTransferId ?? `transfer ${item.id}`,
      href: `/developer/contas/${item.contaId}/financeiro`,
      contaId: item.contaId,
      meta: item.status,
    })),
    ...rematriculas.map((item) => ({
      type: 'Rematrícula' as const,
      title: item.correlationId,
      description: `${item.matriculaOrigemId}${item.matriculaNovaId ? ` → ${item.matriculaNovaId}` : ''}`,
      href: `/developer/contas/${item.contaId}/timeline`,
      contaId: item.contaId,
      meta: `${item.status} · ${item.step}`,
    })),
    ...webhooks.map((item) => ({
      type: 'Webhook' as const,
      title: item.evento,
      description: item.eventId ?? item.id,
      href: `/developer/contas/${item.contaId}/webhooks/${item.id}`,
      contaId: item.contaId,
      meta: item.status,
    })),
  ];
}

export async function listSupportAccounts(query = '') {
  const q = normalizeSearch(query);
  const digits = q.replace(/\D/g, '');

  return prisma.conta.findMany({
    where: q
      ? {
          deletedAt: null,
          OR: [
            { id: q },
            { nome: { contains: q, mode: Prisma.QueryMode.insensitive } },
            ...(digits.length >= 3 ? [{ cpfCnpj: { contains: digits } }] : []),
          ],
        }
      : { deletedAt: null },
    select: {
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
    },
    take: 40,
    orderBy: { updatedAt: 'desc' },
  });
}
