import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  productSchema,
  updateProduct,
  archiveProduct,
  deleteProduct,
  unarchiveProduct,
  toggleProductActive,
  getProduct,
} from '@alusa/lib';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const product = await getProduct(ctx.params.id, contaId);
    if (!product) return jsonError(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado');

    return NextResponse.json({ data: product });
  } catch (e) {
    return jsonError(500, 'ERRO_BUSCAR_PRODUTO', (e as Error).message);
  }
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const body = await req.json();

    if (body.restore === true) {
      try {
        const product = await unarchiveProduct(ctx.params.id, contaId);
        return NextResponse.json({ data: product });
      } catch (err) {
        return jsonError(400, 'ERRO_RESTAURAR_PRODUTO', (err as Error).message);
      }
    }

    if (typeof body.isActive === 'boolean') {
      try {
        const product = await toggleProductActive(ctx.params.id, contaId, body.isActive);
        return NextResponse.json({ data: product });
      } catch (err) {
        return jsonError(400, 'ERRO_TOGGLE_PRODUTO', (err as Error).message);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.sku !== undefined) updateData.sku = body.sku;
    if (body.price !== undefined)
      updateData.price = typeof body.price === 'string' ? Number(body.price) : body.price;
    const averageCost =
      body.averageCost !== undefined
        ? typeof body.averageCost === 'string'
          ? Number(body.averageCost)
          : body.averageCost
        : undefined;
    if (body.lowStockThreshold !== undefined) {
      updateData.lowStockThreshold =
        typeof body.lowStockThreshold === 'string'
          ? Number(body.lowStockThreshold)
          : body.lowStockThreshold;
    }
    if (body.categoryId !== undefined) updateData.categoryId = body.categoryId || null;

    const parsed = productSchema.partial().safeParse(updateData);
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }

    try {
      const product = await updateProduct({
        id: ctx.params.id,
        contaId,
        ...updateData,
        averageCost,
      });
      return NextResponse.json({ data: product });
    } catch (err) {
      return jsonError(400, 'ERRO_ATUALIZAR_PRODUTO', (err as Error).message);
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const url = new URL(req.url);
    const permanent = url.searchParams.get('permanent') === 'true';

    try {
      if (permanent) {
        await deleteProduct(ctx.params.id, contaId);
        return NextResponse.json({ success: true });
      }

      const product = await archiveProduct(ctx.params.id, contaId);
      return NextResponse.json({ data: product });
    } catch (err) {
      return jsonError(
        400,
        permanent ? 'ERRO_EXCLUIR_PRODUTO' : 'ERRO_ARQUIVAR_PRODUTO',
        (err as Error).message,
      );
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
