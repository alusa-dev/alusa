import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getWebhookMetrics, detectWebhookGaps, getWebhookQueueMetrics } from '@alusa/finance';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/webhooks/metrics
 *
 * Retorna métricas agregadas de webhooks e detecção de gaps.
 *
 * Query params:
 * - windowDays: dias para análise (default: 7)
 * - includeGaps: se true, inclui detecção de gaps (default: false)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.contaId) {
      return NextResponse.json(
        { success: false, error: 'Não autorizado' },
        { status: 401 }
      );
    }

    const isAdmin = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Acesso negado' },
        { status: 403 }
      );
    }

    const contaId = session.user.contaId;
    const searchParams = req.nextUrl.searchParams;

    const windowDays = parseInt(searchParams.get('windowDays') ?? '7', 10);
    const includeGaps = searchParams.get('includeGaps') === 'true';

    const [metrics, queue] = await Promise.all([
      getWebhookMetrics(contaId, windowDays),
      getWebhookQueueMetrics({ contaId }),
    ]);

    let gaps = null;
    if (includeGaps) {
      gaps = await detectWebhookGaps(contaId, { windowDays });
    }

    return NextResponse.json({
      success: true,
      data: {
        metrics,
        queue,
        gaps,
      },
    });
  } catch (error) {
    console.error('[admin/webhooks/metrics] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno' },
      { status: 500 }
    );
  }
}
