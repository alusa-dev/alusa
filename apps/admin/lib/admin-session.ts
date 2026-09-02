import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getAdminSession, supportRoleFromAdminRole } from '@alusa/admin-auth';
import type { AdminRole } from '@alusa/admin-auth';
import type { Prisma } from '@prisma/client';
import { prisma } from '@alusa/database';
import { ADMIN_SESSION_COOKIE } from './session';

export type AdminSession = {
  username: string;
  issuedAt: string;
  expiresAt: string;
  supportUserId: string;
  role: ReturnType<typeof supportRoleFromAdminRole>;
  adminRole: AdminRole;
  elevatedPermissions: string[];
};

function toAdminSession(session: NonNullable<Awaited<ReturnType<typeof getAdminSession>>>): AdminSession {
  return {
    username: session.username,
    issuedAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    supportUserId: session.adminUserId,
    role: supportRoleFromAdminRole(session.role),
    adminRole: session.role,
    elevatedPermissions: session.elevatedPermissions,
  };
}

export async function getAdminSessionForRequest(): Promise<AdminSession | null> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const session = await getAdminSession(token);
  return session ? toAdminSession(session) : null;
}

export async function requireAdminSessionForPage(pathname: string) {
  const session = await getAdminSessionForRequest();
  if (!session) {
    const loginUrl = new URL('/login', 'http://admin.local');
    loginUrl.searchParams.set('callbackUrl', pathname);
    redirect(`${loginUrl.pathname}${loginUrl.search}`);
  }

  const accountMatch = pathname.match(/^\/contas\/([^/]+)/);
  try {
    await recordAdminAudit({
      actorId: session.supportUserId,
      actorUsername: session.username,
      actorRole: session.role,
      action: accountMatch ? 'admin.account.view' : 'admin.page.view',
      contaId: accountMatch?.[1] ?? null,
      entityType: accountMatch ? 'CONTA' : 'ADMIN_PAGE',
      entityId: accountMatch?.[1] ?? null,
      metadata: { path: pathname },
    });
  } catch (error) {
    console.error('[admin][audit-unavailable]', { reason: error instanceof Error ? error.name : 'unknown' });
  }
  return session;
}

export async function requireAdminSessionForApi() {
  const session = await getAdminSessionForRequest();
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, error: 'Sessão administrativa expirada ou ausente.' }, { status: 401, headers: { 'cache-control': 'no-store' } }),
    };
  }
  return { ok: true as const, session };
}

export async function recordAdminAudit(input: {
  actorId?: string | null;
  actorUsername?: string | null;
  actorRole?: AdminSession['role'] | null;
  contaId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  action: string;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
}) {
  return prisma.supportAuditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorUsername: input.actorUsername ?? null,
      actorRole: input.actorRole ?? null,
      contaId: input.contaId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      action: input.action,
      reason: input.reason ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      correlationId: input.correlationId ?? null,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  });
}

export function auditActorFromAdminSession(session: AdminSession) {
  return { actorId: session.supportUserId, actorUsername: session.username, actorRole: session.role };
}

export function requestAuditMetadata(req: Request) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: req.headers.get('user-agent') ?? null,
  };
}
