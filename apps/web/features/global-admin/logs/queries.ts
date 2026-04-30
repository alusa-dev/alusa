import type { Prisma } from '@prisma/client';
import { prisma } from '@alusa/database';

import { listGlobalAdminAudit } from '../audit/queries';
import {
  mapGlobalAdminErrorLogResultToDTO,
  mapGlobalAdminRequestLogResultToDTO,
  mapGlobalAdminWebhookLogResultToDTO,
} from './mappers';

function clampLimit(value: number | undefined, fallback = 50, max = 200) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value ?? fallback)));
}

function containsInsensitive(value: string) {
  return { contains: value, mode: 'insensitive' as const };
}

type RequestLogFilters = {
  q?: string;
  contaId?: string;
  status?: 'SUCCESS' | 'ERROR' | 'ALL';
  limit?: number;
};

type WebhookLogFilters = {
  q?: string;
  contaId?: string;
  status?: string;
  limit?: number;
};

type ErrorLogFilters = {
  q?: string;
  contaId?: string;
  limit?: number;
};

export async function listGlobalAdminRequestLogs(input: RequestLogFilters = {}) {
  const q = input.q?.trim() ?? '';
  const limit = clampLimit(input.limit, 50);

  const where: Prisma.LogIntegracaoWhereInput = {
    ...(input.contaId ? { contaId: input.contaId } : {}),
    ...(input.status && input.status !== 'ALL' ? { status: input.status } : {}),
    ...(q
      ? {
          OR: [
            { contaId: { contains: q } },
            { conta: { nome: containsInsensitive(q) } },
            { tipoOperacao: containsInsensitive(q) },
            { entidade: containsInsensitive(q) },
            { entidadeId: { contains: q } },
            { asaasId: { contains: q } },
            { errorMessage: containsInsensitive(q) },
          ],
        }
      : {}),
  };

  const rows = await prisma.logIntegracao.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      contaId: true,
      tipoOperacao: true,
      entidade: true,
      entidadeId: true,
      asaasId: true,
      status: true,
      httpStatus: true,
      duration: true,
      errorMessage: true,
      createdAt: true,
      conta: { select: { nome: true } },
    },
  });

  return mapGlobalAdminRequestLogResultToDTO({
    generatedAt: new Date().toISOString(),
    total: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      contaId: row.contaId,
      contaNome: row.conta.nome,
      tipoOperacao: row.tipoOperacao,
      entidade: row.entidade,
      entidadeId: row.entidadeId,
      asaasId: row.asaasId ?? null,
      status: row.status === 'ERROR' ? 'ERROR' : 'SUCCESS',
      httpStatus: row.httpStatus ?? null,
      duration: row.duration ?? null,
      errorMessage: row.errorMessage ?? null,
      createdAt: row.createdAt.toISOString(),
      href: `/developer/tenants/${row.contaId}`,
    })),
  });
}

export async function listGlobalAdminWebhookLogs(input: WebhookLogFilters = {}) {
  const q = input.q?.trim() ?? '';
  const limit = clampLimit(input.limit, 50);

  const webhookWhere: Prisma.WebhookAsaasWhereInput = {
    ...(input.contaId ? { contaId: input.contaId } : {}),
    ...(input.status && input.status !== 'ALL' && input.status !== 'REJEITADO'
      ? { status: input.status }
      : {}),
    ...(q
      ? {
          OR: [
            { contaId: { contains: q } },
            { conta: { nome: containsInsensitive(q) } },
            { id: { contains: q } },
            { evento: containsInsensitive(q) },
            { eventId: { contains: q } },
            { asaasPaymentId: { contains: q } },
            { ultimoErro: containsInsensitive(q) },
          ],
        }
      : {}),
  };

  const rejectionWhere: Prisma.WebhookAsaasRejectionWhereInput = {
    ...(input.contaId ? { contaId: input.contaId } : {}),
    ...(input.status && input.status !== 'ALL' && input.status !== 'REJEITADO'
      ? { id: '__no_match__' }
      : {}),
    ...(q
      ? {
          OR: [
            { contaId: { contains: q } },
            { id: { contains: q } },
            { evento: containsInsensitive(q) },
            { eventId: { contains: q } },
            { reason: containsInsensitive(q) },
          ],
        }
      : {}),
  };

  const [rows, rejections] = await Promise.all([
    prisma.webhookAsaas.findMany({
      where: webhookWhere,
      orderBy: { recebidoEm: 'desc' },
      take: limit,
      select: {
        id: true,
        contaId: true,
        evento: true,
        eventId: true,
        status: true,
        tentativas: true,
        recebidoEm: true,
        processadoEm: true,
        asaasPaymentId: true,
        ultimoErro: true,
        conta: { select: { nome: true } },
      },
    }),
    prisma.webhookAsaasRejection.findMany({
      where: rejectionWhere,
      orderBy: { recebidoEm: 'desc' },
      take: limit,
      select: {
        id: true,
        contaId: true,
        evento: true,
        eventId: true,
        reason: true,
        recebidoEm: true,
      },
    }),
  ]);

  const accountNames =
    rejections.filter((item) => item.contaId).length > 0
      ? await prisma.conta.findMany({
          where: { id: { in: rejections.flatMap((item) => (item.contaId ? [item.contaId] : [])) } },
          select: { id: true, nome: true },
        })
      : [];

  const accountNameMap = new Map(accountNames.map((item) => [item.id, item.nome]));

  const items = [
    ...rows.map((row) => ({
      id: row.id,
      source: 'WEBHOOK' as const,
      contaId: row.contaId,
      contaNome: row.conta.nome,
      evento: row.evento,
      eventId: row.eventId ?? null,
      status: row.status,
      tentativas: row.tentativas,
      receivedAt: row.recebidoEm.toISOString(),
      processedAt: row.processadoEm?.toISOString() ?? null,
      asaasPaymentId: row.asaasPaymentId ?? null,
      errorMessage: row.ultimoErro ?? null,
      href: `/developer/tenants/${row.contaId}?focusEvent=${row.id}`,
    })),
    ...rejections.map((row) => ({
      id: row.id,
      source: 'REJECTION' as const,
      contaId: row.contaId ?? null,
      contaNome: row.contaId ? accountNameMap.get(row.contaId) ?? null : null,
      evento: row.evento ?? null,
      eventId: row.eventId ?? null,
      status: 'REJEITADO',
      tentativas: 0,
      receivedAt: row.recebidoEm.toISOString(),
      processedAt: null,
      asaasPaymentId: null,
      errorMessage: row.reason,
      href: row.contaId ? `/developer/tenants/${row.contaId}` : null,
    })),
  ]
    .sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime())
    .slice(0, limit);

  return mapGlobalAdminWebhookLogResultToDTO({
    generatedAt: new Date().toISOString(),
    total: items.length,
    items,
  });
}

export async function listGlobalAdminErrorLogs(input: ErrorLogFilters = {}) {
  const q = input.q?.trim() ?? '';
  const limit = clampLimit(input.limit, 50);

  const [requestErrors, webhookErrors, auditErrors] = await Promise.all([
    listGlobalAdminRequestLogs({
      q,
      contaId: input.contaId,
      status: 'ERROR',
      limit: limit,
    }),
    listGlobalAdminWebhookLogs({
      q,
      contaId: input.contaId,
      limit,
    }),
    listGlobalAdminAudit({
      tenantId: input.contaId,
      search: q || undefined,
      status: 'ERROR',
      limit,
    }),
  ]);

  const items = [
    ...requestErrors.items.map((item) => ({
      id: item.id,
      kind: 'REQUISICAO' as const,
      contaId: item.contaId,
      contaNome: item.contaNome,
      title: `${item.tipoOperacao} com falha`,
      summary: item.errorMessage ?? `${item.entidade} ${item.entidadeId} retornou erro.`,
      severity: 'critical' as const,
      createdAt: item.createdAt,
      href: item.href,
    })),
    ...webhookErrors.items
      .filter((item) => item.status === 'ERRO' || item.status === 'EXAURIDO' || item.status === 'REJEITADO')
      .map((item) => ({
        id: item.id,
        kind: 'WEBHOOK' as const,
        contaId: item.contaId,
        contaNome: item.contaNome,
        title: item.status === 'REJEITADO' ? 'Webhook rejeitado' : 'Webhook com falha',
        summary: item.errorMessage ?? `${item.evento ?? 'Evento sem nome'} não foi processado corretamente.`,
        severity: item.status === 'REJEITADO' ? ('critical' as const) : ('warning' as const),
        createdAt: item.receivedAt,
        href: item.href,
      })),
    ...auditErrors.entries.map((item) => ({
      id: item.id,
      kind: 'ADMIN' as const,
      contaId: item.tenantId,
      contaNome: item.tenantName,
      title: 'Ação administrativa com falha',
      summary: item.summary ?? item.action,
      severity: 'warning' as const,
      createdAt: item.createdAt,
      href: item.tenantId ? `/developer/tenants/${item.tenantId}` : null,
    })),
  ]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);

  return mapGlobalAdminErrorLogResultToDTO({
    generatedAt: new Date().toISOString(),
    total: items.length,
    items,
  });
}
