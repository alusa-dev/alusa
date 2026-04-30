import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { listWebhooks, getWebhookMetrics, detectWebhookGaps } from '@alusa/finance';

/**
 * GET /api/admin/webhooks
 *
 * Lista webhooks com filtros para painel admin.
 * Requer autenticação e permissão de admin.
 *
 * Query params:
 * - page: número da página (default: 1)
 * - pageSize: itens por página (default: 20, max: 100)
 * - status: filtrar por status (PENDENTE, PROCESSANDO, PROCESSADO, ERRO)
 * - evento: filtrar por tipo de evento (ex: PAYMENT_CONFIRMED)
 * - asaasPaymentId: filtrar por ID do pagamento
 * - asaasSubscriptionId: filtrar por ID da assinatura
 * - startDate: data inicial (ISO string)
 * - endDate: data final (ISO string)
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

    // Verificar se é admin (ajustar conforme lógica de permissões)
    const isAdmin = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Acesso negado' },
        { status: 403 }
      );
    }

    const contaId = session.user.contaId;
    const searchParams = req.nextUrl.searchParams;

    const page = parseInt(searchParams.get('page') ?? '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);
    const status = searchParams.get('status') ?? undefined;
    const evento = searchParams.get('evento') ?? undefined;
    const asaasPaymentId = searchParams.get('asaasPaymentId') ?? undefined;
    const asaasSubscriptionId = searchParams.get('asaasSubscriptionId') ?? undefined;
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');

    const startDate = startDateStr ? new Date(startDateStr) : undefined;
    const endDate = endDateStr ? new Date(endDateStr) : undefined;

    const result = await listWebhooks(contaId, {
      page,
      pageSize,
      status,
      evento,
      asaasPaymentId,
      asaasSubscriptionId,
      startDate,
      endDate,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[admin/webhooks] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno' },
      { status: 500 }
    );
  }
}
