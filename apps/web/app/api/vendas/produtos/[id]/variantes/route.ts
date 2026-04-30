import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { listProductVariants, generateProductVariants } from '@alusa/lib';

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
    const variants = await listProductVariants(productId, contaId);
    return NextResponse.json({ data: variants });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_VARIANTES', (e as Error).message);
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId } = await Promise.resolve(context.params);
    const body = await req.json().catch(() => ({}));

    if (body.action === 'gerar') {
      const variants = await generateProductVariants(productId, contaId);
      return NextResponse.json({ data: variants }, { status: 201 });
    }

    return jsonError(422, 'ACAO_INVALIDA', 'Use { "action": "gerar" } para gerar combinações');
  } catch (e) {
    return jsonError(400, 'ERRO_GERAR_VARIANTES', (e as Error).message);
  }
}
