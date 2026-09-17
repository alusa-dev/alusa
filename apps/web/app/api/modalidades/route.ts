import { NextResponse } from 'next/server';
import { modalidadeSchema } from '@alusa/lib/schemas/modalidade.schema';
import { createModalidade, listModalidades } from '@alusa/lib/services/modalidade.service';
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
    const page = Number(url.searchParams.get('page') || '1');
    const pageSize = Number(url.searchParams.get('pageSize') || '50');
    const q = url.searchParams.get('q') || undefined;
    const statusParam = url.searchParams.get('status');
    const status = statusParam === 'ATIVO' || statusParam === 'INATIVO' ? statusParam : undefined;
    const result = await listModalidades(contaId, { page, pageSize, q, status });
    return NextResponse.json({
      data: result.data,
      meta: { page: result.page, pageSize: result.pageSize, total: result.total },
    });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_MODALIDADES', 'Não foi possível carregar as modalidades.');
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
    await assertPlatformAccessForConta({ contaId, capability: 'MODALITY_WRITE' });
    const parsed = modalidadeSchema.safeParse({
      nome: body.nome,
      // Normaliza null -> undefined para não quebrar validação
      descricao: body.descricao === null ? undefined : body.descricao,
      status: body.status,
    });
    if (!parsed.success)
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    try {
      const modalidade = await createModalidade({
        contaId,
        nome: parsed.data.nome,
        descricao: parsed.data.descricao,
        status: parsed.data.status,
      });
      return NextResponse.json({ data: modalidade }, { status: 201 });
    } catch (err) {
      return jsonError(400, 'ERRO_CRIAR_MODALIDADE', (err as Error).message);
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
