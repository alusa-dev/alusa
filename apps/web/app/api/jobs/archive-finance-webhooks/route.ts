import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { archiveProcessedWebhooks } from '@alusa/finance';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * GET/POST /api/jobs/archive-finance-webhooks
 *
 * Arquiva webhooks processados antigos da tabela hot para tabela cold.
 *
 * Query params:
 * - contaId (opcional): conta alvo
 * - olderThanDays (opcional): idade mínima para arquivar (default 30)
 * - limit (opcional): máximo por execução (default 500)
 */
export async function POST(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('archive-finance-webhooks', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('archive-finance-webhooks');

    const contaId = tenantScope.contaId;

    const olderThanDaysRaw = Number(url.searchParams.get('olderThanDays') ?? '30');
    const limitRaw = Number(url.searchParams.get('limit') ?? '500');

    const olderThanDays = Number.isFinite(olderThanDaysRaw)
      ? Math.max(1, Math.min(3650, olderThanDaysRaw))
      : 30;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw)) : 500;

    const result = await archiveProcessedWebhooks({
      contaId,
      olderThanDays,
      limit,
    });
    logJobResult('archive-finance-webhooks', startedAt, {
      selected: result.selected,
      archived: result.archived,
      deletedFromHot: result.deletedFromHot,
    }, { workStatus: result.selected > 0 ? 'worked' : 'empty' });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (startedAt) logJobFailure('archive-finance-webhooks', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível arquivar os webhooks agora.');
  }
}

export async function GET(req: Request) {
  return POST(req);
}
