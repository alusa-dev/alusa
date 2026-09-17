import { NextResponse } from 'next/server';
import { turmaSchema } from '@alusa/lib/schemas/turma.schema';
import { updateTurma, deleteTurma } from '@alusa/lib/services/turma.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { assertPlatformAccessForConta } from '@/src/server/platform-billing/capacity';

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
    await assertPlatformAccessForConta({ contaId, capability: 'CLASS_WRITE' });
    const merge = { ...body, contaId };
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
    await assertPlatformAccessForConta({ contaId, capability: 'CLASS_WRITE' });
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
