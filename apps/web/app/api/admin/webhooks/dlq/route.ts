import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { listDlqWebhooks, getDlqStats, requeueDlqWebhooks, requeueAllDlqWebhooks } from '@alusa/finance';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.contaId) {
    return { error: NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 }) };
  }
  const isAdmin = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
  if (!isAdmin) {
    return { error: NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 }) };
  }
  return { contaId: session.user.contaId };
}

/**
 * GET /api/admin/webhooks/dlq
 * Lista webhooks em DLQ (EXAURIDO) com filtros + estatísticas.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;

    const sp = req.nextUrl.searchParams;
    const includeStats = sp.get('includeStats') === 'true';

    const [list, stats] = await Promise.all([
      listDlqWebhooks(auth.contaId, {
        page: parseInt(sp.get('page') ?? '1', 10),
        pageSize: parseInt(sp.get('pageSize') ?? '20', 10),
        evento: sp.get('evento') ?? undefined,
        asaasPaymentId: sp.get('asaasPaymentId') ?? undefined,
        startDate: sp.get('startDate') ? new Date(sp.get('startDate')!) : undefined,
        endDate: sp.get('endDate') ? new Date(sp.get('endDate')!) : undefined,
      }),
      includeStats ? getDlqStats(auth.contaId) : null,
    ]);

    return NextResponse.json({ success: true, data: { list, stats } });
  } catch (error) {
    console.error('[admin/webhooks/dlq] GET error:', error);
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * POST /api/admin/webhooks/dlq
 * Reenfileira webhooks DLQ para reprocessamento.
 *
 * Body:
 * - ids?: string[] — IDs específicos para reenfileirar
 * - all?: boolean — reenfileirar todos (max 200)
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) return auth.error;

    const body = (await req.json().catch(() => ({}))) as {
      ids?: string[];
      all?: boolean;
    };

    let result;
    if (body.all) {
      result = await requeueAllDlqWebhooks(auth.contaId);
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      const safeIds = body.ids.filter((id) => typeof id === 'string').slice(0, 100);
      result = await requeueDlqWebhooks(auth.contaId, safeIds);
    } else {
      return NextResponse.json(
        { success: false, error: 'Envie "ids" ou "all: true"' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[admin/webhooks/dlq] POST error:', error);
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 });
  }
}
