import { NextResponse } from 'next/server';

import { requireGlobalAdminSessionForApi } from '@/features/global-admin/auth/session.server';
import { auditActorFromSession, recordSupportAudit, requestAuditMetadata } from '../audit/support-audit.server';
import type { SupportRole } from '../auth/permissions';

type RateState = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateState>();

function getClientKey(req: Request, scope: string) {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'local';
  return `${scope}:${ip}`;
}

export function supportRateLimit(req: Request, scope: string, limit = 120, windowMs = 60_000) {
  const key = getClientKey(req, scope);
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true as const };
  }

  if (current.count >= limit) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Muitas requisições. Tente novamente em instantes.' },
        { status: 429, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  current.count += 1;
  return { ok: true as const };
}

export async function requireSupportApi(req: Request, options?: { roles?: SupportRole[]; scope?: string }) {
  const rate = supportRateLimit(req, options?.scope ?? 'developer-api');
  if (!rate.ok) return rate;

  const auth = await requireGlobalAdminSessionForApi();
  if (!auth.ok) return auth;

  if (options?.roles && !options.roles.includes(auth.session.role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Permissão insuficiente' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  return { ok: true as const, session: auth.session };
}

export async function recordSupportAccess(
  req: Request,
  input: {
    session: Awaited<ReturnType<typeof requireGlobalAdminSessionForApi>> extends { ok: true; session: infer S }
      ? S
      : never;
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
