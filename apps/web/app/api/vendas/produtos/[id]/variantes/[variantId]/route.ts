import { NextResponse } from 'next/server';
import {
  updateProductVariant,
  deleteProductVariant,
} from '@alusa/lib/services/product-variant.service';
import { productVariantUpdateInputDTOSchema } from '@/features/vendas/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string; variantId: string } | Promise<{ id: string; variantId: string }>;
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId, variantId } = await Promise.resolve(context.params);
    const actorUserId = auth.userId;
    const body = productVariantUpdateInputDTOSchema.parse(await req.json());

    const variant = await updateProductVariant({
      variantId,
      productId,
      contaId,
      actorUserId,
      sku: body.sku,
      price: body.price,
      averageCost: body.averageCost,
      lowStockThreshold: body.lowStockThreshold,
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
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId, variantId } = await Promise.resolve(context.params);
    await deleteProductVariant(variantId, productId, contaId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return jsonError(400, 'ERRO_DELETAR_VARIANTE', (e as Error).message);
  }
}
