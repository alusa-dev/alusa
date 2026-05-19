import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { updateModalidade, deleteModalidade, modalidadeSchema } from '@alusa/lib';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
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
    if (body.nome !== undefined || body.descricao !== undefined) {
      const parsed = modalidadeSchema.pick({ nome: true, descricao: true }).safeParse({
        nome: body.nome,
        descricao: body.descricao === null ? undefined : body.descricao,
      });
      if (!parsed.success)
        return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }
    try {
      const modalidade = await updateModalidade({
        id: ctxParams.id,
        contaId,
        nome: body.nome,
        descricao: body.descricao,
        status: body.status,
      });
      return NextResponse.json({ data: modalidade });
    } catch (e) {
      return jsonError(400, 'ERRO_ATUALIZAR_MODALIDADE', (e as Error).message);
    }
  } catch (e) {
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
      const modalidade = await deleteModalidade(ctxParams.id, contaId);
      return NextResponse.json({ data: modalidade });
    } catch (e) {
      return jsonError(400, 'ERRO_EXCLUIR_MODALIDADE', (e as Error).message);
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
