import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { processPendingInboxNotifications } from '@alusa/lib';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/process-pending-inbox-notifications
 *
 * Reprocessa notificações internas enfileiradas (ex.: webhook antes da entidade local).
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const limitRaw = Number(url.searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

    const result = await processPendingInboxNotifications({
      contaId: tenantScope.contaId ?? undefined,
      limit,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Job Process Pending Inbox] Erro:', error);
    return jsonError(500, 'ERRO_JOB', (error as Error).message);
  }
}
