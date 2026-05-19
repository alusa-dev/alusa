import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { updateTurma, deleteTurma } from '@alusa/lib';
import { turmaSchema } from '@alusa/lib';
import { authOptions } from '@/lib/auth-options';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const body = await req.json();
    const contaId = typeof body.contaId === 'string' ? body.contaId.trim() : '';
    if (!contaId) return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionContaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (sessionContaId && contaId !== sessionContaId) {
      return jsonError(
        403,
        'CONTA_INVALIDA',
        'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const merge = { ...body };
    // valida conjunto parcial mesclando id/contaId para garantir shape
    const parsed = turmaSchema.safeParse(merge);
    if (!parsed.success)
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    try {
      const turma = await updateTurma({ ...parsed.data, id: ctxParams.id, contaId });
      return NextResponse.json({ data: turma });
    } catch (e: unknown) {
      return jsonError(400, 'ERRO_ATUALIZAR_TURMA', (e as Error).message);
    }
  } catch (e: unknown) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const url = new URL(req.url);
    const contaId = url.searchParams.get('contaId')?.trim() || null;
    if (!contaId) return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionContaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (sessionContaId && contaId !== sessionContaId) {
      return jsonError(
        403,
        'CONTA_INVALIDA',
        'A conta informada não pertence ao usuário autenticado.',
      );
    }
    try {
      const turma = await deleteTurma(ctxParams.id, contaId);
      return NextResponse.json({ data: turma });
    } catch (e: unknown) {
      return jsonError(400, 'ERRO_EXCLUIR_TURMA', (e as Error).message);
    }
  } catch (e: unknown) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
