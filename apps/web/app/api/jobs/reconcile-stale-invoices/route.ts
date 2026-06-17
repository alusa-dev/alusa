import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { reconcileStaleInvoices } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function clampPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.trunc(parsed))) : fallback;
}

/**
 * GET/POST /api/jobs/reconcile-stale-invoices
 *
 * Reconsulta o Asaas para notas fiscais antigas em status SCHEDULED/SYNCHRONIZED/ERROR.
 *
 * Query params:
 * - contaId (opcional): restringe para uma conta, validada contra sessão ou cron token.
 * - limit (opcional): limite de notas, default 50.
 * - staleOlderThanMinutes (opcional): idade mínima, default 60.
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

    const result = await reconcileStaleInvoices({
      contaId: tenantScope.contaId,
      limit: clampPositiveInt(url.searchParams.get('limit'), 50, 200),
      staleOlderThanMinutes: clampPositiveInt(
        url.searchParams.get('staleOlderThanMinutes'),
        60,
        24 * 60,
      ),
    });

    return NextResponse.json({ success: result.failed === 0, result });
  } catch (error) {
    console.error('[Job Reconcile Stale Invoices] Erro:', error);
    return jsonError(500, 'ERRO_JOB', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
