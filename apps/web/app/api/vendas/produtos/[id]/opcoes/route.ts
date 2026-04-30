import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { listProductOptions, createProductOption } from '@alusa/lib';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string } | Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId } = await Promise.resolve(context.params);
    const options = await listProductOptions(productId, contaId);
    return NextResponse.json({ data: options });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_OPCOES', (e as Error).message);
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId } = await Promise.resolve(context.params);
    const body = await req.json();

    if (!body.name?.trim()) {
      return jsonError(422, 'DADOS_INVALIDOS', '"name" é obrigatório');
    }

    const option = await createProductOption({ productId, contaId, name: body.name });
    return NextResponse.json({ data: option }, { status: 201 });
  } catch (e) {
    return jsonError(400, 'ERRO_CRIAR_OPCAO', (e as Error).message);
  }
}
