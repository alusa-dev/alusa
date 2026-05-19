import { NextResponse } from 'next/server';
import { updateSala, deleteSala, salaSchema } from '@alusa/lib';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    // MULTI-TENANT: validar sessão e usar contaId da sessão
    const session = await getServerSession(authOptions);
    const sessionContaId = (session as { user?: { contaId?: string } })?.user?.contaId;
    if (!sessionContaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const body = await req.json();
    const contaId = sessionContaId; // Usar contaId da sessão, ignorar body.contaId
    if (
      body.nome !== undefined ||
      body.capacidade !== undefined ||
      body.status !== undefined ||
      body.descricao !== undefined
    ) {
      const parsed = salaSchema.partial().safeParse({
        nome: body.nome,
        capacidade: body.capacidade,
        status: body.status,
        // Normaliza null -> undefined
        descricao: body.descricao === null ? undefined : body.descricao,
      });
      if (!parsed.success)
        return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }
    try {
      const sala = await updateSala({
        id: ctxParams.id,
        contaId,
        nome: body.nome,
        descricao: body.descricao,
        capacidade: body.capacidade,
        status: body.status,
      });
      return NextResponse.json({ data: sala });
    } catch (e) {
      return jsonError(400, 'ERRO_ATUALIZAR_SALA', (e as Error).message);
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    // MULTI-TENANT: validar sessão e usar contaId da sessão
    const session = await getServerSession(authOptions);
    const contaId = (session as { user?: { contaId?: string } })?.user?.contaId;
    if (!contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    try {
      const sala = await deleteSala(ctxParams.id, contaId);
      return NextResponse.json({ data: sala });
    } catch (e) {
      return jsonError(400, 'ERRO_EXCLUIR_SALA', (e as Error).message);
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
