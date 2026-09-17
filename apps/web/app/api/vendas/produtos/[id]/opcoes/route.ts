import { NextResponse } from 'next/server';
import {
  listProductOptions,
  createProductOption,
} from '@alusa/lib/services/product-option.service';
import { productOptionCreateInputDTOSchema } from '@/features/vendas/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
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
    const options = await listProductOptions(productId, contaId);
    return NextResponse.json({ data: options });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_OPCOES', 'Não foi possível carregar as opções.');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId } = await Promise.resolve(context.params);
    const parsed = productOptionCreateInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError(422, 'DADOS_INVALIDOS', '"name" é obrigatório');
    }

    const option = await createProductOption({ productId, contaId, name: parsed.data.name });
    return NextResponse.json({ data: option }, { status: 201 });
  } catch (e) {
    return jsonError(400, 'ERRO_CRIAR_OPCAO', (e as Error).message);
  }
}
