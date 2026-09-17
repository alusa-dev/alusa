import { NextResponse } from 'next/server';
import { salaSchema } from '@alusa/lib/schemas/sala.schema';
import { updateSala, deleteSala } from '@alusa/lib/services/sala.service';
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
          ? 'Usuário não autenticado'
          : 'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const contaId = tenant.contaId;
    await assertPlatformAccessForConta({ contaId, capability: 'ROOM_WRITE' });
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
    const tenant = await resolveTenantSession(new URL(req.url).searchParams.get('contaId'));
    if (!tenant.ok) {
      return jsonError(
        tenant.reason === 'UNAUTHENTICATED' ? 401 : 403,
        tenant.reason === 'UNAUTHENTICATED' ? 'NAO_AUTENTICADO' : 'CONTA_INVALIDA',
        tenant.reason === 'UNAUTHENTICATED'
          ? 'Usuário não autenticado'
          : 'A conta informada não pertence ao usuário autenticado.',
      );
    }
    const contaId = tenant.contaId;
    await assertPlatformAccessForConta({ contaId, capability: 'ROOM_WRITE' });

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
