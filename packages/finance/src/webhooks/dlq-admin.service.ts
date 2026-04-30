/**
 * DLQ Admin Service
 *
 * Operações administrativas sobre webhooks marcados como EXAURIDO (DLQ):
 * - Listagem paginada
 * - Detalhes por ID
 * - Replay manual (individual ou batch)
 * - Estatísticas
 */

import { prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

// ── Types ────────────────────────────────────────────────────────────────

export interface DlqListOptions {
  page?: number;
  pageSize?: number;
  evento?: string;
  asaasPaymentId?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface DlqListItem {
  id: string;
  evento: string;
  eventId: string | null;
  recebidoEm: Date;
  tentativas: number;
  ultimoErro: string | null;
  asaasPaymentId: string | null;
  asaasSubscriptionId: string | null;
  contaId: string;
}

export interface DlqListResult {
  items: DlqListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DlqStats {
  total: number;
  byEvent: Record<string, number>;
  oldestAt: Date | null;
  newestAt: Date | null;
  avgAttempts: number;
  generatedAt: Date;
}

export interface DlqRequeueResult {
  requeued: number;
  ids: string[];
  generatedAt: Date;
}

// ── List ─────────────────────────────────────────────────────────────────

export async function listDlqWebhooks(
  contaId: string,
  options: DlqListOptions = {},
): Promise<DlqListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.WebhookAsaasWhereInput = {
    contaId,
    status: 'EXAURIDO',
    ...(options.evento && { evento: { contains: options.evento } }),
    ...(options.asaasPaymentId && { asaasPaymentId: options.asaasPaymentId }),
    ...(options.startDate && { recebidoEm: { gte: options.startDate } }),
    ...(options.endDate && { recebidoEm: { lte: options.endDate } }),
  };

  const [items, total] = await Promise.all([
    prisma.webhookAsaas.findMany({
      where,
      select: {
        id: true,
        evento: true,
        eventId: true,
        recebidoEm: true,
        tentativas: true,
        ultimoErro: true,
        asaasPaymentId: true,
        asaasSubscriptionId: true,
        contaId: true,
      },
      orderBy: { recebidoEm: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.webhookAsaas.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ── Stats ────────────────────────────────────────────────────────────────

export async function getDlqStats(contaId: string): Promise<DlqStats> {
  const dlqWebhooks = await prisma.webhookAsaas.findMany({
    where: { contaId, status: 'EXAURIDO' },
    select: {
      evento: true,
      recebidoEm: true,
      tentativas: true,
    },
    orderBy: { recebidoEm: 'asc' },
  });

  const byEvent: Record<string, number> = {};
  let totalAttempts = 0;

  for (const w of dlqWebhooks) {
    byEvent[w.evento] = (byEvent[w.evento] ?? 0) + 1;
    totalAttempts += w.tentativas;
  }

  return {
    total: dlqWebhooks.length,
    byEvent,
    oldestAt: dlqWebhooks[0]?.recebidoEm ?? null,
    newestAt: dlqWebhooks[dlqWebhooks.length - 1]?.recebidoEm ?? null,
    avgAttempts: dlqWebhooks.length > 0 ? Math.round(totalAttempts / dlqWebhooks.length) : 0,
    generatedAt: new Date(),
  };
}

// ── Requeue ──────────────────────────────────────────────────────────────

/**
 * Move webhooks de DLQ de volta para PENDENTE para reprocessamento.
 * Reseta tentativas para 0 e limpa nextRetryAt.
 */
export async function requeueDlqWebhooks(
  contaId: string,
  webhookIds: string[],
): Promise<DlqRequeueResult> {
  if (webhookIds.length === 0) {
    return { requeued: 0, ids: [], generatedAt: new Date() };
  }

  // Validar que todos pertencem à conta e estão em EXAURIDO
  const valid = await prisma.webhookAsaas.findMany({
    where: {
      id: { in: webhookIds },
      contaId,
      status: 'EXAURIDO',
    },
    select: { id: true },
  });

  const validIds = valid.map((w) => w.id);
  if (validIds.length === 0) {
    return { requeued: 0, ids: [], generatedAt: new Date() };
  }

  const result = await prisma.webhookAsaas.updateMany({
    where: { id: { in: validIds } },
    data: {
      status: 'PENDENTE',
      tentativas: 0,
      ultimoErro: null,
      nextRetryAt: null,
    },
  });

  console.info('[dlq-admin] Webhooks reenfileirados', {
    contaId,
    requeued: result.count,
    ids: validIds,
  });

  return {
    requeued: result.count,
    ids: validIds,
    generatedAt: new Date(),
  };
}

/**
 * Move TODOS os webhooks DLQ de uma conta de volta para PENDENTE.
 */
export async function requeueAllDlqWebhooks(
  contaId: string,
  limit = 200,
): Promise<DlqRequeueResult> {
  const candidates = await prisma.webhookAsaas.findMany({
    where: { contaId, status: 'EXAURIDO' },
    select: { id: true },
    orderBy: { recebidoEm: 'asc' },
    take: limit,
  });

  const ids = candidates.map((c) => c.id);
  return requeueDlqWebhooks(contaId, ids);
}
