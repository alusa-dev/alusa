import { NextResponse } from 'next/server';
import { getKycViewModel } from '@alusa/finance';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const auth = await resolveTenantSession();
  return auth.ok ? { id: auth.userId, contaId: auth.contaId, role: auth.role } : null;
}

export async function GET() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const viewModel = await getKycViewModel(user.contaId);
    return json(200, { data: viewModel });
  } catch (error) {
    console.error('[Finance KYC][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
