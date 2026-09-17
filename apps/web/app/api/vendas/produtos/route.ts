import { NextResponse } from 'next/server';
import { productSchema } from '@alusa/lib/schemas/product.schema';
import { createProduct, listProducts } from '@alusa/lib/services/product.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET(req: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const url = new URL(req.url);
    const page = Number(url.searchParams.get('page') || '1');
    const pageSize = Number(url.searchParams.get('pageSize') || '50');
    const q = url.searchParams.get('q') || undefined;
    const categoryId = url.searchParams.get('categoryId') || undefined;
    const archived = url.searchParams.get('archived') === 'true';
    const activeOnly = url.searchParams.get('activeOnly') === 'true';

    const result = await listProducts(contaId, {
      page,
      pageSize,
      q,
      categoryId,
      archived,
      activeOnly,
    });
    return NextResponse.json({
      data: result.data,
      meta: { page: result.page, pageSize: result.pageSize, total: result.total },
    });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_PRODUTOS', 'Não foi possível carregar os produtos.');
  }
}

export async function POST(req: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const body = await req.json();
    const priceValue = typeof body.price === 'string' ? Number(body.price) : body.price;
    const averageCost =
      body.averageCost !== undefined
        ? typeof body.averageCost === 'string'
          ? Number(body.averageCost)
          : body.averageCost
        : undefined;
    const lowStockThreshold =
      typeof body.lowStockThreshold === 'string'
        ? Number(body.lowStockThreshold)
        : body.lowStockThreshold;
    const initialStock =
      body.initialStock !== undefined
        ? typeof body.initialStock === 'string'
          ? Number(body.initialStock)
          : body.initialStock
        : undefined;

    const parsed = productSchema.safeParse({
      name: body.name,
      description: body.description === null ? undefined : body.description,
      sku: body.sku === null ? undefined : body.sku,
      price: priceValue,
      lowStockThreshold,
      categoryId: body.categoryId || null,
    });

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    }

    try {
      const product = await createProduct({ contaId, ...parsed.data, averageCost, initialStock });
      return NextResponse.json({ data: product }, { status: 201 });
    } catch (err) {
      return jsonError(400, 'ERRO_CRIAR_PRODUTO', (err as Error).message);
    }
  } catch (e) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error).message);
  }
}
