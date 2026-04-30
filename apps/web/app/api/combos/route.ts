import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { comboCreateSchema, comboFilterSchema, listCombos, createCombo } from '@alusa/lib';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function resolveContaId(explicit?: string | null) {
  const session = await getServerSession(authOptions).catch(() => null);
  const sessionContaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId || null;
  const requested = explicit?.trim() || null;
  if (requested && sessionContaId && requested !== sessionContaId) {
    return { contaId: null, mismatch: true, sessionContaId };
  }
  return { contaId: requested || sessionContaId, mismatch: false, sessionContaId };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const contaCtx = await resolveContaId(url.searchParams.get('contaId'));
    if (contaCtx.mismatch) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta não pertence ao usuário.');
    }
    if (!contaCtx.contaId) return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');

    const statusParam = url.searchParams.get('status');
    const searchParam = url.searchParams.get('q') ?? undefined;
    const parsed = comboFilterSchema.safeParse({
      contaId: contaCtx.contaId,
      status: statusParam === 'ATIVO' || statusParam === 'INATIVO' ? statusParam : undefined,
      search: searchParam,
    });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Filtros inválidos', parsed.error.flatten());
    }
    const combos = await listCombos(parsed.data);
    return NextResponse.json({ data: combos });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_COMBOS', (e as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return jsonError(400, 'REQUISICAO_INVALIDA', 'Payload inválido');
    const contaCtx = await resolveContaId((body as { contaId?: string }).contaId ?? null);
    if (contaCtx.mismatch) return jsonError(403, 'CONTA_INVALIDA', 'Conta inválida');
    if (!contaCtx.contaId) return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório');
    const parsed = comboCreateSchema.safeParse({ ...body, contaId: contaCtx.contaId });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }
    try {
      const combo = await createCombo(parsed.data);
      return NextResponse.json({ data: combo }, { status: 201 });
    } catch (err) {
      return jsonError(400, 'ERRO_CRIAR_COMBO', (err as Error).message);
    }
  } catch (e) {
    return jsonError(500, 'ERRO_CRIAR_COMBO', (e as Error).message);
  }
}
