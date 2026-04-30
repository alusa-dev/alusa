import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { updateProductVariant, deleteProductVariant } from '@alusa/lib';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string; variantId: string } | Promise<{ id: string; variantId: string }>;
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId, variantId } = await Promise.resolve(context.params);
    const body = await req.json();

    const variant = await updateProductVariant({
      variantId,
      productId,
      contaId,
      sku: body.sku,
      price:
        body.price !== undefined ? (body.price === null ? null : Number(body.price)) : undefined,
      averageCost: body.averageCost !== undefined ? Number(body.averageCost) : undefined,
      lowStockThreshold:
        body.lowStockThreshold !== undefined ? Number(body.lowStockThreshold) : undefined,
      imageUrl: body.imageUrl,
      isActive: body.isActive,
    });

    return NextResponse.json({ data: variant });
  } catch (e) {
    return jsonError(400, 'ERRO_ATUALIZAR_VARIANTE', (e as Error).message);
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId, variantId } = await Promise.resolve(context.params);
    await deleteProductVariant(variantId, productId, contaId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return jsonError(400, 'ERRO_DELETAR_VARIANTE', (e as Error).message);
  }
}
