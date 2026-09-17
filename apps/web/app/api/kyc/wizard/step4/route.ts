import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { saveWizardStep4, wizardStep4Schema } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const auth = await resolveTenantSession();
  return auth.ok ? { id: auth.userId, contaId: auth.contaId, role: auth.role } : null;
}

/**
 * POST /api/kyc/wizard/step4
 * Salva endereço no Step 4.
 */
export async function POST(req: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || user.role.toUpperCase() !== 'ADMIN') return json(403, { error: 'SEM_PERMISSAO' });

    const payload = wizardStep4Schema.parse(await req.json());

    const result = await saveWizardStep4({
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

    console.error('[Finance Wizard][Step4][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
