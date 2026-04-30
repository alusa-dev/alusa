import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { categorySchema, createCategory, listCategories } from '@alusa/lib';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const data = await listCategories(contaId);
    return NextResponse.json({ data });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_CATEGORIAS', (e as Error).message);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const body = await req.json();
    const parsed = categorySchema.safeParse({ name: body.name });
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }

    try {
      const category = await createCategory({ contaId, name: parsed.data.name });
      return NextResponse.json({ data: category }, { status: 201 });
    } catch (err) {
      return jsonError(400, 'ERRO_CRIAR_CATEGORIA', (err as Error).message);
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
