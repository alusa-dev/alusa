import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { NextResponse } from 'next/server';
import { getKycSummary } from '@alusa/finance';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const auth = await resolveTenantSession();
  return auth.ok ? { id: auth.userId, contaId: auth.contaId, role: auth.role } : null;
}

export async function GET(request: Request = new Request('http://localhost/api/kyc/summary')) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return json(403, { error: 'SEM_PERMISSAO' });

    const summary = await getKycSummary(user.contaId);
    return json(200, { data: summary });
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.kyc.request.failed',
      route: '/api/kyc/summary',
      method: 'GET',
      requestId: getRequestId(request),
      error,
    });
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
