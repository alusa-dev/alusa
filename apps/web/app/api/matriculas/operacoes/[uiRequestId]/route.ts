import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { readEnrollmentCreationStatus } from '@/src/server/matriculas/enrollment-creation-status.service';

const requestIdSchema = z.string().trim().min(1).max(200);
const roles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const headers = { 'cache-control': 'no-store' };

export async function GET(req: Request, context: { params: Promise<{ uiRequestId: string }> }) {
  try {
    const requestedConta = new URL(req.url).searchParams.get('contaId');
    const auth = await resolveTenantSession(requestedConta);
    if (!auth.ok) {
      const isTenantMismatch = auth.reason === 'CONTA_MISMATCH';
      return NextResponse.json(
        { error: { message: isTenantMismatch ? 'Permissão negada.' : 'Usuário não autenticado.' } },
        { status: isTenantMismatch ? 403 : 401, headers },
      );
    }
    if (!roles.has(String(auth.role).toUpperCase())) {
      return NextResponse.json({ error: { message: 'Permissão negada.' } }, { status: 403, headers });
    }
    const parsed = requestIdSchema.safeParse((await context.params).uiRequestId);
    if (!parsed.success) {
      return NextResponse.json({ error: { message: 'Identificador inválido.' } }, { status: 400, headers });
    }
    return NextResponse.json(await readEnrollmentCreationStatus(auth.contaId, parsed.data), { headers });
  } catch {
    return NextResponse.json(
      { error: { message: 'Não foi possível consultar a confirmação. Tente novamente.' } },
      { status: 503, headers },
    );
  }
}
