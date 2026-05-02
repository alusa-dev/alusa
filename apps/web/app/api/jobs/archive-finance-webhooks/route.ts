import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { archiveProcessedWebhooks } from '@alusa/finance';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/archive-finance-webhooks
 *
 * Arquiva webhooks processados antigos da tabela hot para tabela cold.
 *
 * Query params:
 * - contaId (opcional): conta alvo
 * - olderThanDays (opcional): idade mínima para arquivar (default 30)
 * - limit (opcional): máximo por execução (default 500)
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

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[Job Archive Finance Webhooks] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Falha ao arquivar webhooks financeiros.');
  }
}
