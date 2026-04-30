import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { modalidadeSchema, createModalidade, listModalidades } from '@alusa/lib';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const contaIdFromQuery = url.searchParams.get('contaId')?.trim() || null;
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionContaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    const contaId = contaIdFromQuery ?? sessionContaId;

    if (!contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (sessionContaId && contaId !== sessionContaId) {
      return jsonError(
        403,
        'CONTA_INVALIDA',
        'A conta informada não pertence ao usuário autenticado.',
      );
    }
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
    return jsonError(500, 'ERRO_LISTAR_MODALIDADES', (e as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const contaIdFromBody = typeof body.contaId === 'string' ? body.contaId.trim() : null;
    const session = await getServerSession(authOptions).catch(() => null);
    const sessionContaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    const contaId = contaIdFromBody ?? sessionContaId;
    if (!contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
    if (sessionContaId && contaId !== sessionContaId) {
      return jsonError(
        403,
        'CONTA_INVALIDA',
        'A conta informada não pertence ao usuário autenticado.',
      );
    }
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
