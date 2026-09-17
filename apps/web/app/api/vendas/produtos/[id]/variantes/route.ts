import { NextResponse } from 'next/server';
import {
  bulkUpdateProductVariants,
  listProductVariants,
  generateProductVariants,
} from '@alusa/lib/services/product-variant.service';
import { z } from 'zod';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function publicVariantError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (
    message.startsWith('Não é possível') ||
    message === 'Produto não encontrado' ||
    message.startsWith('Adicione')
  ) {
    return message;
  }

  return 'Não foi possível sincronizar as variantes. Tente novamente.';
}

interface RouteContext {
  params: { id: string } | Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId } = await Promise.resolve(context.params);
    const variants = await listProductVariants(productId, contaId);
    return NextResponse.json({ data: variants });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_VARIANTES', 'Não foi possível carregar as variantes.');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId } = await Promise.resolve(context.params);
    const body = await req.json().catch(() => ({}));

    if (body.action === 'gerar') {
      const variants = await generateProductVariants(productId, contaId);
      return NextResponse.json({ data: variants }, { status: 201 });
    }

    return jsonError(422, 'ACAO_INVALIDA', 'Use { "action": "gerar" } para gerar variantes');
  } catch (e) {
    console.error('[vendas/produtos/variantes] Falha ao gerar variantes', e);
    return jsonError(400, 'ERRO_GERAR_VARIANTES', publicVariantError(e));
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId } = await Promise.resolve(context.params);
    const actorUserId = auth.userId;
    const body = await req.json();
    const parsed = z.object({
      action: z.literal('precificar-massa'),
      variantIds: z.array(z.string().min(1)).min(1),
      price: z.number().finite().positive(),
      averageCost: z.number().finite().nonnegative(),
    }).safeParse(body);
    if (!parsed.success) return jsonError(422, 'DADOS_INVALIDOS', 'Informe preço, custo e variantes válidos.');

    const variants = await bulkUpdateProductVariants({
      productId,
      contaId,
      actorUserId,
      ...parsed.data,
    });
    return NextResponse.json({ data: variants });
  } catch (e) {
    return jsonError(400, 'ERRO_PRECIFICAR_VARIANTES', (e as Error).message);
  }
}
