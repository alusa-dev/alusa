import type { PrismaClient } from '@prisma/client';

import { requestEvidence } from '@/lib/privacy/evidence';

type SensitiveAccessRole = string | null | undefined;

export type SensitiveAccessPurpose =
  | 'STUDENT_DETAIL'
  | 'STUDENT_EDIT'
  | 'RESPONSAVEL_DETAIL'
  | 'RESPONSAVEL_EDIT'
  | 'ENROLLMENT_CONTRACT'
  | 'FINANCIAL_BILLING'
  | 'SUPPORT_CASE'
  | 'PORTAL_SELF_SERVICE'
  | 'LGPD_EXPORT';

export type SensitiveAccessUser = {
  id?: string | null;
  role?: SensitiveAccessRole;
  contaId?: string | null;
};

type CanViewSensitivePersonDataInput = {
  user: SensitiveAccessUser;
  contaId: string;
  purpose: SensitiveAccessPurpose;
};

const privilegedInstitutionalRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const portalRoles = new Set(['RESPONSAVEL']);

function normalizeRole(role: SensitiveAccessRole) {
  return role?.trim().toUpperCase() ?? '';
}

export function canViewSensitivePersonData(input: CanViewSensitivePersonDataInput) {
  if (!input.user.id || !input.user.contaId || input.user.contaId !== input.contaId) {
    return false;
  }

  const role = normalizeRole(input.user.role);
  if (input.purpose === 'PORTAL_SELF_SERVICE') {
    return portalRoles.has(role);
  }

  return privilegedInstitutionalRoles.has(role);
}

type AuditSensitiveAccessInput = {
  prisma: Pick<PrismaClient, 'sensitiveAccessLog'>;
  req: Request;
  contaId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  purpose: SensitiveAccessPurpose;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function auditSensitiveAccess(input: AuditSensitiveAccessInput) {
  try {
    const evidence = requestEvidence(input.req);
    await input.prisma.sensitiveAccessLog.create({
      data: {
        contaId: input.contaId,
        actorUserId: input.actorUserId ?? undefined,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? undefined,
        requestId: input.requestId ?? undefined,
        ipHash: evidence.ipHash,
        userAgentHash: evidence.userAgentHash,
        metadata: {
          purpose: input.purpose,
          ...input.metadata,
        },
      },
    });
  } catch (error) {
    console.error('[privacy][sensitive-access] audit failed', {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
