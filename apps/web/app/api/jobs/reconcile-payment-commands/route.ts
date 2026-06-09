import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { reconcilePendingPaymentCommands } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/reconcile-payment-commands
 *
 * Reconsulta o Asaas para comandos financeiros pendentes e abre divergência
 * quando a confirmação por webhook/sync não chega dentro da janela esperada.
 *
 * Query params:
 * - contaId (opcional): restringe para uma conta.
 * - limit (opcional): limite de comandos, default 50.
 * - pollOlderThanSeconds (opcional): idade mínima para polling, default 30.
 * - staleOlderThanMinutes (opcional): idade para abrir divergência, default 10.
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

    const limitRaw = Number(url.searchParams.get('limit') ?? '50');
    const pollOlderThanSecondsRaw = Number(url.searchParams.get('pollOlderThanSeconds') ?? '30');
    const staleOlderThanMinutesRaw = Number(url.searchParams.get('staleOlderThanMinutes') ?? '10');

    const result = await reconcilePendingPaymentCommands({
      contaId: tenantScope.contaId,
      limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50,
      pollOlderThanSeconds: Number.isFinite(pollOlderThanSecondsRaw)
        ? Math.max(5, Math.min(60 * 60, pollOlderThanSecondsRaw))
        : 30,
      staleOlderThanMinutes: Number.isFinite(staleOlderThanMinutesRaw)
        ? Math.max(1, Math.min(24 * 60, staleOlderThanMinutesRaw))
        : 10,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[Job Reconcile Payment Commands] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
