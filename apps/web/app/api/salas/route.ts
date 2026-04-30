import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { salaSchema, createSala, listSalas } from '@alusa/lib';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const contaIdFromQuery = url.searchParams.get('contaId')?.trim() || null;
    let contaId = contaIdFromQuery;
    if (!contaId) {
      const session = await getServerSession(authOptions).catch(() => null);
      contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    }
    if (!contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
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
    return jsonError(500, 'ERRO_LISTAR_SALAS', (e as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const contaIdFromBody = typeof body.contaId === 'string' ? body.contaId.trim() : '';
    let contaId = contaIdFromBody || null;
    if (!contaId) {
      const session = await getServerSession(authOptions).catch(() => null);
      contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    }
    if (!contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    }
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
