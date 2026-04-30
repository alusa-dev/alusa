import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { deleteProductImage, setPrimaryProductImage } from '@alusa/lib/server';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string; imageId: string } | Promise<{ id: string; imageId: string }>;
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId, imageId } = await Promise.resolve(context.params);
    await deleteProductImage(imageId, productId, contaId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return jsonError(400, 'ERRO_DELETAR_IMAGEM', (e as Error).message);
  }
}

export async function PATCH(_req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId, imageId } = await Promise.resolve(context.params);
    const image = await setPrimaryProductImage(imageId, productId, contaId);
    return NextResponse.json({ data: image });
  } catch (e) {
    return jsonError(400, 'ERRO_MARCAR_PRIMARIA', (e as Error).message);
  }
}
