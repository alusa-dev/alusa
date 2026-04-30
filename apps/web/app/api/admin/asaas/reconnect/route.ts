import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { reconnectAsaasAccount, type ReconnectAsaasResult } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { role?: string; contaId?: string; id?: string };
    const user = (session as { user?: SessUser } | null)?.user;

    if (!user?.contaId) {
      return json(401, { success: false, summary: 'Acesso negado.' });
    }

    const role = user.role?.toUpperCase() ?? '';
    if (!['ADMIN', 'FINANCEIRO'].includes(role)) {
      return json(403, { success: false, summary: 'Acesso negado.' });
    }

    const payload = (await request.json().catch(() => null)) as { apiKey?: string } | null;
    const apiKey = payload?.apiKey?.trim() ?? '';
    if (!apiKey) {
      return json(400, { success: false, summary: 'API key é obrigatória.' });
    }

    const result: ReconnectAsaasResult = await reconnectAsaasAccount({
      contaId: user.contaId,
      apiKey,
      actor: { id: user.id ?? null, type: 'ADMIN' },
    });

    return json(result.success ? 200 : 400, result);
  } catch (e) {
    console.error('[API admin/asaas/reconnect][POST] Erro', e);
    return json(500, {
      success: false,
      summary: 'Erro interno ao reconectar conta Asaas.',
      errorCode: 'UNEXPECTED_ERROR',
    });
  }
}
