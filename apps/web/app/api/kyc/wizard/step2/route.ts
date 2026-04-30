import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ZodError } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { saveWizardStep2 } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

/**
 * POST /api/kyc/wizard/step2
 * Salva identificação (PF/PJ) no Step 2.
 */
export async function POST(req: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || user.role.toUpperCase() !== 'ADMIN') return json(403, { error: 'SEM_PERMISSAO' });

    const payload = (await req.json()) as unknown;

    const result = await saveWizardStep2({
      contaId: user.contaId,
      data: payload as never,
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

    console.error('[Finance Wizard][Step2][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
