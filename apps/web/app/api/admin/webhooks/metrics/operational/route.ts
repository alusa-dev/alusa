import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { collectOperationalMetrics, toPrometheusText } from '@alusa/finance';

/**
 * GET /api/admin/webhooks/metrics/operational
 *
 * Retorna snapshot operacional completo (circuit breaker, quota, rate limit,
 * concurrency, API calls) em JSON ou Prometheus text format.
 *
 * Query params:
 * - format: "json" (default) ou "prometheus"
 * - windowMinutes: janela de tempo para API calls (default: 60)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.contaId) {
      return NextResponse.json(
        { success: false, error: 'Não autorizado' },
        { status: 401 },
      );
    }

    const isAdmin = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Acesso negado' },
        { status: 403 },
      );
    }

    const sp = req.nextUrl.searchParams;
    const format = sp.get('format') ?? 'json';
    const windowMinutes = parseInt(sp.get('windowMinutes') ?? '60', 10);

    const metrics = collectOperationalMetrics(windowMinutes);

    if (format === 'prometheus') {
      return new NextResponse(toPrometheusText(metrics), {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    return NextResponse.json({ success: true, data: metrics });
  } catch (error) {
    console.error('[admin/webhooks/metrics/operational] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno' },
      { status: 500 },
    );
  }
}
