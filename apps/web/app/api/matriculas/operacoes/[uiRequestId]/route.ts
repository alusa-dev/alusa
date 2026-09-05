import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import { readEnrollmentCreationStatus } from '@/src/server/matriculas/enrollment-creation-status.service';

const requestIdSchema = z.string().trim().min(1).max(200);
const roles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);
const headers = { 'cache-control': 'no-store' };

export async function GET(req: Request, context: { params: Promise<{ uiRequestId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user;
    if (!user?.id || !user.contaId) {
      return NextResponse.json({ error: { message: 'Usuário não autenticado.' } }, { status: 401, headers });
    }
    const requestedConta = new URL(req.url).searchParams.get('contaId');
    if (!roles.has(String(user.role).toUpperCase()) || (requestedConta && requestedConta !== user.contaId)) {
      return NextResponse.json({ error: { message: 'Permissão negada.' } }, { status: 403, headers });
    }
    const parsed = requestIdSchema.safeParse((await context.params).uiRequestId);
    if (!parsed.success) {
      return NextResponse.json({ error: { message: 'Identificador inválido.' } }, { status: 400, headers });
    }
    return NextResponse.json(await readEnrollmentCreationStatus(user.contaId, parsed.data), { headers });
  } catch {
    return NextResponse.json(
      { error: { message: 'Não foi possível consultar a confirmação. Tente novamente.' } },
      { status: 503, headers },
    );
  }
}
