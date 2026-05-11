import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getDashboardFinanceKpisLocal } from '@alusa/finance';

import { authOptions } from '@/lib/auth-options';
import { dashboardFinanceKpisResultDTOSchema } from '@/features/dashboard/dtos';
import { PrivateMemoryCache, privateJson } from '@/lib/private-cache';

const dashboardFinanceKpisCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 15,
  staleWhileRevalidateSeconds: 60,
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;

    if (!contaId) {
      return NextResponse.json(
        { success: false, error: 'Não autenticado' },
        { status: 401 },
      );
    }

    const cached = dashboardFinanceKpisCache.get(contaId);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      return privateJson(cached.body, {
        maxAgeSeconds: 15,
        staleWhileRevalidateSeconds: 60,
        cacheState: cached.state,
      });
    }

    const snapshot = await getDashboardFinanceKpisLocal({ contaId });
    const body = dashboardFinanceKpisResultDTOSchema.parse({
      success: true,
      data: snapshot,
    });

    dashboardFinanceKpisCache.set(contaId, body);

    return privateJson(body, {
      maxAgeSeconds: 15,
      staleWhileRevalidateSeconds: 60,
      cacheState: 'MISS',
    });
  } catch (error) {
    console.error('[GET /api/dashboard/finance-kpis] Erro:', error);
    return NextResponse.json(
      {
        success: false,
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}