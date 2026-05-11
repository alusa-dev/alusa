import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { authOptions } from '@/lib/auth-options';
import {
  connectExternalAsaasAccount,
  getExternalAsaasOnboardingState,
  type ConnectExternalAsaasAccountResult,
} from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
  financeIntegrationMode?: string;
};

const externalOnboardingSchema = z.object({
  schoolName: z.string().min(2),
  cpfCnpj: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  apiKey: z.string().min(10),
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

function isAllowedRole(role: string | undefined): boolean {
  const normalized = role?.toUpperCase() ?? '';
  return normalized === 'ADMIN' || normalized === 'FINANCEIRO';
}

export async function GET() {
  try {
    const user = await resolveAuth();
    if (!user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!isAllowedRole(user.role)) return json(403, { error: 'SEM_PERMISSAO' });
    if (user.financeIntegrationMode !== 'EXTERNAL_ASAAS_ACCOUNT') {
      return json(409, { error: 'FLUXO_NAO_DISPONIVEL' });
    }

    const state = await getExternalAsaasOnboardingState(user.contaId);
    return json(200, { data: state });
  } catch (error) {
    console.error('[External Asaas Onboarding][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function POST(request: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.contaId) return json(401, { success: false, summary: 'Acesso negado.' });
    if (!isAllowedRole(user.role)) return json(403, { success: false, summary: 'Acesso negado.' });
    if (user.financeIntegrationMode !== 'EXTERNAL_ASAAS_ACCOUNT') {
      return json(409, { success: false, summary: 'Fluxo externo indisponível para esta conta.' });
    }

    const parsed = externalOnboardingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return json(400, { success: false, summary: 'Dados inválidos para conectar a conta do Asaas.' });
    }

    const result: ConnectExternalAsaasAccountResult = await connectExternalAsaasAccount({
      contaId: user.contaId,
      schoolName: parsed.data.schoolName,
      cpfCnpj: parsed.data.cpfCnpj,
      phone: parsed.data.phone,
      apiKey: parsed.data.apiKey,
      actor: { id: user.id ?? null, type: 'ADMIN' },
    });

    const status = result.success ? (result.status === 'READY' ? 200 : 202) : 400;
    return json(status, result);
  } catch (error) {
    console.error('[External Asaas Onboarding][POST]', error);
    return json(500, {
      success: false,
      summary: 'Erro interno ao conectar a conta do Asaas.',
      errorCode: 'UNEXPECTED_ERROR',
    });
  }
}