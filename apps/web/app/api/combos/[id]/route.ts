import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { comboUpdateSchema, updateCombo, deleteCombo } from '@alusa/lib';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function resolveContaId(explicit?: string | null) {
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionContaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true, sessionContaId };
  }
  return { contaId: requested || sessionContaId, mismatch: false, sessionContaId };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return jsonError(400, 'REQUISICAO_INVALIDA', 'Payload inválido');
    const contaCtx = await resolveContaId((body as { contaId?: string }).contaId ?? null);
    if (contaCtx.mismatch) return jsonError(403, 'CONTA_INVALIDA', 'Conta inválida');
    if (!contaCtx.contaId) return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    const parsed = comboUpdateSchema.safeParse({
      ...body,
      id: rawParams.id,
      contaId: contaCtx.contaId,
    });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }
    try {
      const combo = await updateCombo(parsed.data);
      return NextResponse.json({ data: combo });
    } catch (err) {
      return jsonError(400, 'ERRO_ATUALIZAR_COMBO', (err as Error).message);
    }
  } catch (e) {
    return jsonError(500, 'ERRO_ATUALIZAR_COMBO', (e as Error).message);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const body = await req.json().catch(() => null);
    const contaCtx = await resolveContaId((body as { contaId?: string } | null)?.contaId ?? null);
    if (contaCtx.mismatch) return jsonError(403, 'CONTA_INVALIDA', 'Conta inválida');
    if (!contaCtx.contaId) return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    try {
      const combo = await deleteCombo(rawParams.id, contaCtx.contaId);
      return NextResponse.json({ data: combo });
    } catch (err) {
      return jsonError(400, 'ERRO_EXCLUIR_COMBO', (err as Error).message);
    }
  } catch (e) {
    return jsonError(500, 'ERRO_EXCLUIR_COMBO', (e as Error).message);
  }
}
