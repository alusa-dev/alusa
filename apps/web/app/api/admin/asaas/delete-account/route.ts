import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { excluirContaAlusaEAsaas, type DeleteAsaasAccountResult } from '@alusa/finance';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

const bodySchema = z.object({
  confirmText: z.string(),
  removeReason: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; role?: string; contaId?: string };
    const user = (session as { user?: SessUser } | null)?.user;

    if (!user?.contaId) {
      return json(401, { success: false, summary: 'Acesso negado.' });
    }

    const role = user.role?.toUpperCase() ?? '';
    if (role !== 'ADMIN') {
      return json(403, { success: false, summary: 'Acesso negado.' });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return json(400, { success: false, summary: 'Payload inválido.' });
    }

    const result: DeleteAsaasAccountResult = await excluirContaAlusaEAsaas({
      contaId: user.contaId,
      confirmText: parsed.data.confirmText,
      removeReason: parsed.data.removeReason,
      actor: { type: 'ADMIN', id: user.id },
      requestId:
        req.headers.get('x-request-id') ??
        req.headers.get('x-correlation-id') ??
        undefined,
    });

    if (result.success) return json(200, result);

    // erros de validação
    if (result.errorCode === 'CONFIRM_TEXT_INVALID' || result.errorCode === 'REMOVE_REASON_REQUIRED') {
      return json(400, result);
    }

    // exclusão concorrente
    if (result.errorCode === 'DELETE_ALREADY_IN_PROGRESS') {
      return json(409, result);
    }

    // falhas do Asaas (external-first: nunca delete localmente)
    if (
      result.errorCode === 'ASAAS_DELETE_FAILED' ||
      result.errorCode === 'ASAAS_DELETE_HAS_PENDING' ||
      result.errorCode === 'ASAAS_DELETE_NOT_ALLOWED' ||
      result.errorCode === 'EXTERNAL_NOT_FOUND_INCONSISTENT'
    ) {
      return json(502, result);
    }

    return json(400, result);
  } catch (e) {
    console.error('[API admin/asaas/delete-account][POST] Erro', e);
    return json(500, {
      success: false,
      summary: 'Erro interno ao excluir conta (Asaas + Alusa).',
      errorCode: 'UNEXPECTED_ERROR',
    });
  }
}
