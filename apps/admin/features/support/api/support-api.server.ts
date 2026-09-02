import { NextResponse } from 'next/server';

import { authRateLimitAsync, ipFromRequest } from '@/lib/rate-limit';
import { requireAdminSessionForApi } from '@/lib/admin-session';
import { auditActorFromSession, recordSupportAudit, requestAuditMetadata } from '../audit/support-audit.server';
import { hasSupportRoleAccess } from '../auth/permissions';
import type { SupportRole } from '../auth/permissions';

function getClientKey(req: Request, scope: string) {
  return `admin:${scope}:${ipFromRequest(req)}`;
}

function getAccountIdFromRequest(req: Request): string | null {
  try {
    const pathname = new URL(req.url).pathname;
    return pathname.match(/\/contas\/([^/]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function supportRateLimit(req: Request, scope: string, limit = 120, windowMs = 60_000) {
  const result = await authRateLimitAsync(getClientKey(req, scope), limit, windowMs);
  if (result.ok) return { ok: true as const };

  return {
    ok: false as const,
    response: NextResponse.json(
      { success: false, error: 'Muitas requisições. Tente novamente em instantes.' },
      {
        status: 429,
        headers: {
          'cache-control': 'no-store',
          'retry-after': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
        },
      },
    ),
  };
}

export async function requireSupportApi(req: Request, options?: { roles?: SupportRole[]; scope?: string }) {
  const rate = await supportRateLimit(req, options?.scope ?? 'admin-api');
  if (!rate.ok) return rate;

  const auth = await requireAdminSessionForApi();
  if (!auth.ok) return auth;

  if (options?.roles && !hasSupportRoleAccess(auth.session, options.roles, options.scope)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Permissão insuficiente' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  const accountId = getAccountIdFromRequest(req);
  await recordSupportAccess(req, {
    session: auth.session,
    action: accountId ? 'admin.account.access' : 'admin.api.access',
    contaId: accountId,
    entityType: accountId ? 'CONTA' : 'ADMIN_API',
    entityId: accountId,
    metadata: { scope: options?.scope ?? 'admin-api', method: req.method },
  });

  return { ok: true as const, session: auth.session };
}

export async function recordSupportAccess(
  req: Request,
  input: {
    session: import('@/lib/admin-session').AdminSession;
    action: string;
    contaId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: import('@prisma/client').Prisma.InputJsonValue;
  },
) {
  await recordSupportAudit({
    ...auditActorFromSession(input.session),
    ...requestAuditMetadata(req),
    action: input.action,
    contaId: input.contaId,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? undefined,
  });
}

export function parseRequiredReason(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 8) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Informe um motivo com pelo menos 8 caracteres.' },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  return { ok: true as const, reason: value.trim().slice(0, 500) };
}
