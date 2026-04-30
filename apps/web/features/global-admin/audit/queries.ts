import { prisma } from '@alusa/database';

import { globalAdminAuditFilterSchema } from '../auth/schemas';
import { mapGlobalAdminAuditLogResultToDTO } from './mappers';

type AuditMetadata = {
  actorIdentifier?: string;
  reason?: string | null;
  status?: 'SUCCESS' | 'ERROR';
  resultSummary?: string | null;
};

function readMetadata(value: unknown): AuditMetadata {
  if (!value || typeof value !== 'object') return {};
  return value as AuditMetadata;
}

export async function listGlobalAdminAudit(input: unknown = {}) {
  const filters = globalAdminAuditFilterSchema.parse(input);

  const rows = await prisma.auditLog.findMany({
    where: {
      action: {
        startsWith: 'global_admin.',
        ...(filters.action ? { contains: filters.action } : {}),
      },
      ...(filters.tenantId ? { contaId: filters.tenantId } : {}),
      ...(filters.actorIdentifier ? { actorId: { contains: filters.actorIdentifier } } : {}),
    },
    select: {
      id: true,
      contaId: true,
      action: true,
      actorId: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
      conta: { select: { nome: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.max(filters.limit, 100),
  });

  const entries = rows
    .map((row) => {
      const metadata = readMetadata(row.metadata);
      return {
        id: row.id,
        tenantId: row.contaId,
        tenantName: row.conta.nome,
        action: row.action,
        actorIdentifier: metadata.actorIdentifier ?? row.actorId ?? 'desconhecido',
        targetType: row.entityType ?? null,
        targetId: row.entityId ?? null,
        reason: metadata.reason ?? null,
        status: metadata.status === 'ERROR' ? 'ERROR' : 'SUCCESS',
        summary: metadata.resultSummary ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    })
    .filter((entry) => {
      if (!filters.search) return true;
      const text = `${entry.tenantName} ${entry.action} ${entry.targetId ?? ''} ${entry.reason ?? ''} ${entry.summary ?? ''}`.toLowerCase();
      return text.includes(filters.search.toLowerCase());
    })
    .filter((entry) => (filters.status ? entry.status === filters.status : true))
    .slice(0, filters.limit);

  return mapGlobalAdminAuditLogResultToDTO({
    generatedAt: new Date().toISOString(),
    entries,
  });
}
