import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { runWebhookScheduler } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/jobs/webhook-scheduler
 *
 * Execução unificada de manutenção de webhooks.
 * Projetado para cron externo (ex: Vercel Cron, a cada 2 minutos).
 *
 * Auth: x-cron-token ou sessão ADMIN.
 *
 * Query params opcionais:
 * - contaId: restringe para 1 conta
 * - drainLimit: máx de webhooks a processar (default 200)
 * - skipHealthCheck: "true" para pular health check remoto
 * - skipDriftCheck: "true" para pular drift detection
 * - skipArchive: "true" para pular archiving
 */
async function run(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const drainLimit = Number(url.searchParams.get('drainLimit') ?? '200');

    const result = await runWebhookScheduler({
      contaId: tenantScope.contaId,
      drainLimit: Number.isFinite(drainLimit) ? drainLimit : 200,
      skipHealthCheck: url.searchParams.get('skipHealthCheck') === 'true',
      skipDriftCheck: url.searchParams.get('skipDriftCheck') === 'true',
      skipArchive: url.searchParams.get('skipArchive') === 'true',
      enableReconciliation: url.searchParams.get('enableReconciliation') === 'true',
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[webhook-scheduler] Erro:', error);
    return NextResponse.json(
      { error: { code: 'SCHEDULER_ERROR', message: (error as Error).message } },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
