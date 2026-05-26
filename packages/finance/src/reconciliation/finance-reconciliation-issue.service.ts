import { prisma } from '@alusa/database';
import type {
  FinanceReconciliationEntityType,
  FinanceReconciliationIssueSeverity,
  FinanceReconciliationIssueStatus,
  FinanceReconciliationIssueType,
  Prisma,
} from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';

export type UpsertFinanceReconciliationIssueInput = {
  contaId: string;
  entityType: FinanceReconciliationEntityType;
  entityId?: string | null;
  asaasId?: string | null;
  issueType: FinanceReconciliationIssueType;
  severity: FinanceReconciliationIssueSeverity;
  localStatus?: string | null;
  remoteStatus?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export type ListFinanceReconciliationIssuesOptions = {
  contaId: string;
  status?: FinanceReconciliationIssueStatus;
  severity?: FinanceReconciliationIssueSeverity;
  issueType?: FinanceReconciliationIssueType;
  page?: number;
  pageSize?: number;
};

export function buildFinanceReconciliationIssueDedupeKey(input: {
  entityType: FinanceReconciliationEntityType;
  entityId?: string | null;
  asaasId?: string | null;
  issueType: FinanceReconciliationIssueType;
}): string {
  const entityRef = input.entityId?.trim() || input.asaasId?.trim() || 'unknown';
  return `${input.issueType}:${input.entityType}:${entityRef}`;
}

export async function upsertFinanceReconciliationIssue(input: UpsertFinanceReconciliationIssueInput) {
  const now = new Date();
  const dedupeKey = buildFinanceReconciliationIssueDedupeKey(input);

  return prisma.financeReconciliationIssue.upsert({
    where: {
      uq_fin_recon_issue_conta_dedupe: {
        contaId: input.contaId,
        dedupeKey,
      },
    },
    create: {
      contaId: input.contaId,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      asaasId: input.asaasId ?? null,
      issueType: input.issueType,
      severity: input.severity,
      dedupeKey,
      localStatus: input.localStatus ?? null,
      remoteStatus: input.remoteStatus ?? null,
      detectedAt: now,
      lastSeenAt: now,
      metadata: input.metadata ?? undefined,
    },
    update: {
      status: 'OPEN',
      severity: input.severity,
      entityId: input.entityId ?? undefined,
      asaasId: input.asaasId ?? undefined,
      localStatus: input.localStatus ?? null,
      remoteStatus: input.remoteStatus ?? null,
      lastSeenAt: now,
      resolvedAt: null,
      resolution: null,
      metadata: input.metadata ?? undefined,
    },
  });
}

export async function resolveFinanceReconciliationIssue(input: {
  contaId: string;
  issueId: string;
  resolution: string;
  actor: { type: 'SYSTEM' | 'USER' | 'ADMIN'; id?: string | null };
}) {
  const resolution = input.resolution.trim();
  if (resolution.length < 8) {
    throw new Error('Informe um motivo de resolução com pelo menos 8 caracteres.');
  }

  const issue = await prisma.financeReconciliationIssue.findFirst({
    where: { id: input.issueId, contaId: input.contaId },
  });

  if (!issue) {
    throw new Error('Divergência financeira não encontrada para esta conta.');
  }

  const resolved = await prisma.financeReconciliationIssue.update({
    where: {
      id: issue.id,
    },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolution,
    },
  });

  await auditLogService.record({
    contaId: input.contaId,
    action: 'finance.reconciliation_issue.resolved',
    entity: { type: 'FinanceReconciliationIssue', id: issue.id },
    metadata: {
      issueType: resolved.issueType,
      entityType: resolved.entityType,
      entityId: resolved.entityId,
      asaasId: resolved.asaasId,
      resolution,
    },
    actor: input.actor.id ? { type: input.actor.type, id: input.actor.id } : { type: input.actor.type },
  });

  return resolved;
}

export async function resolveFinanceReconciliationIssueByDedupe(input: {
  contaId: string;
  dedupeKey: string;
  resolution: string;
}) {
  return prisma.financeReconciliationIssue.updateMany({
    where: {
      contaId: input.contaId,
      dedupeKey: input.dedupeKey,
      status: 'OPEN',
    },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolution: input.resolution,
    },
  });
}

export async function listFinanceReconciliationIssues(options: ListFinanceReconciliationIssuesOptions) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const where: Prisma.FinanceReconciliationIssueWhereInput = {
    contaId: options.contaId,
    ...(options.status ? { status: options.status } : {}),
    ...(options.severity ? { severity: options.severity } : {}),
    ...(options.issueType ? { issueType: options.issueType } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.financeReconciliationIssue.findMany({
      where,
      orderBy: [
        { status: 'asc' },
        { severity: 'asc' },
        { lastSeenAt: 'desc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.financeReconciliationIssue.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getFinanceReconciliationIssueSummary(contaId: string) {
  const [openBySeverity, openByType, needsReview, webhookDrift] = await Promise.all([
    prisma.financeReconciliationIssue.groupBy({
      by: ['severity'],
      where: { contaId, status: 'OPEN' },
      _count: { _all: true },
    }),
    prisma.financeReconciliationIssue.groupBy({
      by: ['issueType'],
      where: { contaId, status: 'OPEN' },
      _count: { _all: true },
    }),
    prisma.financeReconciliationIssue.count({
      where: { contaId, status: 'OPEN', issueType: 'PAYMENT_NEEDS_REVIEW' },
    }),
    prisma.financeReconciliationIssue.count({
      where: { contaId, status: 'OPEN', issueType: 'WEBHOOK_CONFIG_DRIFT' },
    }),
  ]);

  return {
    openBySeverity: Object.fromEntries(openBySeverity.map((item) => [item.severity, item._count._all])),
    openByType: Object.fromEntries(openByType.map((item) => [item.issueType, item._count._all])),
    needsReview,
    webhookDrift,
  };
}
