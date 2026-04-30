import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { testarConexaoAsaas, type TesteAsaasResult } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST() {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { role?: string; contaId?: string };
    const user = (session as { user?: SessUser } | null)?.user;

    if (!user?.contaId) {
      return json(401, { success: false, summary: 'Acesso negado.' });
    }

    const role = user.role?.toUpperCase() ?? '';
    if (!['ADMIN', 'FINANCEIRO'].includes(role)) {
      return json(403, { success: false, summary: 'Acesso negado.' });
    }

    const result: TesteAsaasResult = await testarConexaoAsaas({ contaId: user.contaId });

    return json(result.success ? 200 : 400, result);
  } catch (e) {
    console.error('[API admin/teste-asaas][POST] Erro', e);
    return json(500, {
      success: false,
      summary: 'Erro interno ao testar conexão com o Asaas.',
      errorCode: 'UNEXPECTED_ERROR',
    });
  }
}
