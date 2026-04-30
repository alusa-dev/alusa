import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { approveSandboxKyc } from '@alusa/finance/use-cases/kyc/approve-sandbox-kyc';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

/**
 * POST /api/kyc/sandbox/approve
 *
 * Aprova a conta no Asaas sandbox.
 * Disponível apenas em ambiente sandbox; retorna 403 em produção.
 */
export async function POST() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const result = await approveSandboxKyc(user.contaId);

    if (!result.success) {
      const status = result.reason === 'NOT_SANDBOX' ? 403 : 422;
      return json(status, { error: result.reason, message: result.message });
    }

    return json(200, { data: { generalStatus: result.generalStatus } });
  } catch (error) {
    console.error('[KYC Sandbox Approve][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
