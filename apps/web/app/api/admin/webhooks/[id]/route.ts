import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getWebhookDetails } from '@alusa/finance';

/**
 * GET /api/admin/webhooks/[id]
 *
 * Retorna detalhes de um webhook específico incluindo payload e tentativas.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const contaId = session.user.contaId;

    const result = await getWebhookDetails(contaId, id);

    if (!result.webhook) {
      return NextResponse.json(
        { success: false, error: 'Webhook não encontrado' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[admin/webhooks/[id]] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno' },
      { status: 500 }
    );
  }
}
