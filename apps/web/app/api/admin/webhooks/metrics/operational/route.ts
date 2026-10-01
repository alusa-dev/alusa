import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { collectOperationalMetrics } from '@alusa/finance';
import { prisma } from '@alusa/database';
import { createStructuredLog } from '@alusa/observability';
import { getRequestId } from '@/lib/observability/api-logger';

/**
 * GET /api/admin/webhooks/metrics/operational
 *
 * Retorna um snapshot local ao processo, para diagnóstico de superadmin.
 * Não é endpoint de scrape: métricas de produção são enviadas pelo provider
 * e este estado varia por instância/serverless cold start.
 *
 * Query params:
 * - windowMinutes: janela de tempo para API calls (default: 60)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Não autorizado' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      );
    }

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Acesso negado' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      );
    }

    const sp = req.nextUrl.searchParams;
    const requestedFormat = sp.get('format');
    if (requestedFormat && requestedFormat !== 'json') {
      return NextResponse.json(
        { success: false, error: 'FORMATO_NAO_SUPORTADO' },
        { status: 406, headers: { 'cache-control': 'no-store' } },
      );
    }
    const parsedWindow = Number.parseInt(sp.get('windowMinutes') ?? '60', 10);
    const windowMinutes = Number.isFinite(parsedWindow) ? Math.min(60, Math.max(1, parsedWindow)) : 60;
    const metrics = collectOperationalMetrics(windowMinutes);

    // Global operational snapshots can contain state from multiple accounts.
    // Record the privileged read durably, without copying metric values or
    // account keys into the audit trail. Do not return the snapshot if auditing
    // is unavailable.
    await prisma.supportAuditLog.create({
      data: {
        actorId: session.user.id,
        actorUsername: session.user.email,
        action: 'admin.observability.operational_metrics.viewed',
        entityType: 'GLOBAL_OPERATIONAL_METRICS',
        correlationId: getRequestId(req),
        userAgent: req.headers.get('user-agent'),
        metadata: {
          actorRole: 'SUPER_ADMIN',
          scope: 'instance-local',
          windowMinutes,
        },
      },
    });

    return NextResponse.json(
      { success: true, scope: 'instance-local', data: metrics },
      { headers: { 'cache-control': 'no-store', 'x-observability-scope': 'instance-local' } },
    );
  } catch (error) {
    const log = createStructuredLog({
      severity: 'error',
      'service.name': 'alusa-web',
      'event.name': 'admin.operational_metrics.failed',
      'error.type': error instanceof Error ? error.name : 'unknown_error',
    });
    console.error(JSON.stringify(log));
    return NextResponse.json(
      { success: false, error: 'Erro interno' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
