import { NextResponse } from 'next/server';
import { modalidadeSchema } from '@alusa/lib/schemas/modalidade.schema';
import { updateModalidade, deleteModalidade } from '@alusa/lib/services/modalidade.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { assertPlatformAccessForConta } from '@/src/server/platform-billing/capacity';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const body = await req.json();
    const tenant = await resolveTenantSession(
      typeof body.contaId === 'string' ? body.contaId : null,
    );
    if (!tenant.ok) {
      return jsonError(
        tenant.reason === 'UNAUTHENTICATED' ? 401 : 403,
        tenant.reason === 'UNAUTHENTICATED' ? 'NAO_AUTENTICADO' : 'CONTA_INVALIDA',
        tenant.reason === 'UNAUTHENTICATED'
          ? 'Usuário não autenticado.'
          : 'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const contaId = tenant.contaId;
    await assertPlatformAccessForConta({ contaId, capability: 'MODALITY_WRITE' });
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
    const tenant = await resolveTenantSession(url.searchParams.get('contaId'));
    if (!tenant.ok) {
      return jsonError(
        tenant.reason === 'UNAUTHENTICATED' ? 401 : 403,
        tenant.reason === 'UNAUTHENTICATED' ? 'NAO_AUTENTICADO' : 'CONTA_INVALIDA',
        tenant.reason === 'UNAUTHENTICATED'
          ? 'Usuário não autenticado.'
          : 'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const contaId = tenant.contaId;
    await assertPlatformAccessForConta({ contaId, capability: 'MODALITY_WRITE' });
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
