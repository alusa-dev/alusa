import { NextResponse } from 'next/server';
import { salaSchema } from '@alusa/lib/schemas/sala.schema';
import { createSala, listSalas } from '@alusa/lib/services/sala.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { assertPlatformAccessForConta } from '@/src/server/platform-billing/capacity';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET(req: Request) {
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
    await assertPlatformAccessForConta({ contaId, capability: 'ROOM_WRITE' });
    const page = Number(url.searchParams.get('page') || '1');
    const pageSize = Number(url.searchParams.get('pageSize') || '50');
    const q = url.searchParams.get('q') || undefined;
    const statusParam = url.searchParams.get('status');
    const status = statusParam === 'ATIVO' || statusParam === 'INATIVO' ? statusParam : undefined;
    const result = await listSalas(contaId as string, { page, pageSize, q, status });
    return NextResponse.json({
      data: result.data,
      meta: { page: result.page, pageSize: result.pageSize, total: result.total },
    });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_SALAS', 'Não foi possível carregar as salas.');
  }
}

export async function POST(req: Request) {
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
    // Normaliza capacidade para número se vier como string
    const capacidadeValue =
      typeof body.capacidade === 'string' && body.capacidade.trim() !== ''
        ? Number(body.capacidade)
        : body.capacidade;
    const parsed = salaSchema.safeParse({
      nome: body.nome,
      // Normaliza null -> undefined para schema (evita 422 de clientes antigos)
      descricao: body.descricao === null ? undefined : body.descricao,
      capacidade: capacidadeValue,
      status: body.status,
    });
    if (!parsed.success)
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    try {
      const sala = await createSala({
        contaId,
        nome: parsed.data.nome,
        descricao: parsed.data.descricao,
        capacidade: parsed.data.capacidade,
        status: parsed.data.status,
      });
      return NextResponse.json({ data: sala }, { status: 201 });
    } catch (err) {
      return jsonError(400, 'ERRO_CRIAR_SALA', (err as Error).message);
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
