import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  AsaasHttpError,
  asaasGetMyAccountCommercialInfo,
  asaasGetMyAccountStatus,
} from '@alusa/finance';

import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
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

    const payload = (await request.json().catch(() => null)) as { apiKey?: string } | null;
    const apiKey = payload?.apiKey?.trim() ?? '';

    if (apiKey.length < 10) {
      return json(400, { success: false, summary: 'API key inválida.' });
    }

    const [status, commercialInfo] = await Promise.all([
      asaasGetMyAccountStatus({ apiKey }),
      asaasGetMyAccountCommercialInfo({ apiKey }).catch(() => null),
    ]);

    if (!status?.id) {
      return json(400, {
        success: false,
        summary: 'A conta do Asaas não retornou um identificador válido.',
      });
    }

    const email = typeof commercialInfo?.email === 'string' ? commercialInfo.email.trim() : '';

    return json(200, {
      success: true,
      summary: email
        ? `Conexão validada com sucesso para ${email}.`
        : 'Conexão validada com sucesso.',
    });
  } catch (error) {
    if (error instanceof AsaasHttpError && (error.status === 401 || error.status === 403)) {
      return json(400, {
        success: false,
        summary: 'API key inválida ou sem permissão para acessar a conta do Asaas.',
      });
    }

    console.error('[API admin/asaas/test-key][POST] Erro', error);
    return json(500, {
      success: false,
      summary: 'Erro interno ao testar a conexão com o Asaas.',
    });
  }
}