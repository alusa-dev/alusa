import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { completeWizard } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const auth = await resolveTenantSession();
  return auth.ok ? { id: auth.userId, contaId: auth.contaId, role: auth.role } : null;
}

/**
 * POST /api/kyc/wizard/complete
 * Finaliza o wizard de onboarding e enfileira (ou reaproveita) provisionamento da subconta Asaas no white-label.
 * Com `QUEUED`, a conta segue em FINANCE_ONBOARDING_STARTED até o job criar subconta + chave; ver `apps/web/vercel.json` crons.
 */
export async function POST() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || user.role.toUpperCase() !== 'ADMIN') return json(403, { error: 'SEM_PERMISSAO' });

    const result = await completeWizard({
      contaId: user.contaId,
      actor: { type: 'USER', id: user.id },
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Finance Wizard][Complete][POST] Result:', {
        success: result.success,
        canCreateSubaccount: result.canCreateSubaccount,
        asaasAccountId: result.asaasAccountId,
        error: result.error
      });
    }

    return json(result.success && result.provisioningStatus === 'QUEUED' ? 202 : 200, { data: result });
  } catch (error) {
    console.error('[Finance Wizard][Complete][POST]', error);
    return json(500, {
      error: 'ERRO_INTERNO',
      details: undefined,
    });
  }
}
