import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { saveWizardStep3, wizardStep3Schema } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const auth = await resolveTenantSession();
  return auth.ok ? { id: auth.userId, contaId: auth.contaId, role: auth.role } : null;
}

/**
 * POST /api/kyc/wizard/step3
 * Salva dados de contato no Step 3.
 */
export async function POST(req: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || user.role.toUpperCase() !== 'ADMIN') return json(403, { error: 'SEM_PERMISSAO' });

    const payload = wizardStep3Schema.parse(await req.json());

    const result = await saveWizardStep3({
      contaId: user.contaId,
      data: payload,
      actor: { type: 'USER', id: user.id },
    });

    return json(200, { data: result });
  } catch (error) {
    if (error instanceof ZodError) {
      const firstError = error.errors[0];
      return json(400, {
        error: 'VALIDACAO',
        message: firstError?.message ?? 'Dados inválidos',
        details: error.errors,
      });
    }

    console.error('[Finance Wizard][Step3][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
