import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getDashboardFinanceKpisLocal } from '@alusa/finance';

import { authOptions } from '@/lib/auth-options';
import { dashboardFinanceKpisResultDTOSchema } from '@/features/dashboard/dtos';
import { createPerfTimer, logRoutePerformance } from '@/lib/perf-logger';
import { logRuntimeEnvironmentOnce } from '@/lib/runtime-environment';

async function buildFinanceKpisBody(contaId: string) {
  const snapshot = await getDashboardFinanceKpisLocal({ contaId });
  return dashboardFinanceKpisResultDTOSchema.parse({
    success: true,
    data: snapshot,
  });
}

export async function GET() {
  const startedAt = Date.now();
  const timer = createPerfTimer('api/dashboard/finance-kpis');
  let contaIdForLog: string | null = null;
  let cacheStateForLog = 'BYPASS';
  let statusCodeForLog = 200;

  try {
    logRuntimeEnvironmentOnce('api/dashboard/finance-kpis');
    const session = await getServerSession(authOptions);
    const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;
    contaIdForLog = contaId ?? null;

    if (!contaId) {
      statusCodeForLog = 401;
      return NextResponse.json(
        { success: false, error: 'Não autenticado' },
        { status: 401 },
      );
    }

    const body = await buildFinanceKpisBody(contaId);

    cacheStateForLog = 'BYPASS';
    timer.end('GET /dashboard/finance-kpis', { contaId, cacheState: cacheStateForLog });

    return NextResponse.json(body, {
      headers: {
        'cache-control': 'no-store',
        'x-alusa-cache': 'BYPASS',
      },
    });
  } catch (error) {
    statusCodeForLog = 500;
    console.error('[GET /api/dashboard/finance-kpis] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 },
    );
  } finally {
    logRoutePerformance({
      route: 'api/dashboard/finance-kpis',
      method: 'GET',
      contaId: contaIdForLog,
      durationMs: Date.now() - startedAt,
      cacheState: cacheStateForLog,
      statusCode: statusCodeForLog,
    });
  }
}
