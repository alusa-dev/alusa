import { NextResponse } from 'next/server';
import {
  deleteProductOption,
  addOptionValue,
} from '@alusa/lib/services/product-option.service';
import { productOptionValueCreateInputDTOSchema } from '@/features/sales/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function publicOptionValueError(error: unknown, value?: string): string {
  const prismaError = error as { code?: unknown };
  if (prismaError.code === 'P2002') {
    const normalizedValue = value?.trim();
    return normalizedValue
      ? `O valor “${normalizedValue}” já foi cadastrado nesta variante.`
      : 'Este valor já foi cadastrado nesta variante.';
  }

  return 'Não foi possível adicionar este valor agora. Tente novamente.';
}

interface RouteContext {
  params: { id: string; optionId: string } | Promise<{ id: string; optionId: string }>;
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId, optionId } = await Promise.resolve(context.params);
    await deleteProductOption(optionId, productId, contaId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return jsonError(400, 'ERRO_DELETAR_OPCAO', (e as Error).message);
  }
}

export async function POST(req: Request, context: RouteContext) {
  let submittedValue: string | undefined;
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId, optionId } = await Promise.resolve(context.params);
    const parsed = productOptionValueCreateInputDTOSchema.safeParse(await req.json());
    submittedValue = parsed.success ? parsed.data.value : undefined;
    if (!parsed.success) {
      return jsonError(422, 'DADOS_INVALIDOS', '"value" é obrigatório');
    }

    const value = await addOptionValue({ optionId, productId, contaId, value: parsed.data.value });
    return NextResponse.json({ data: value }, { status: 201 });
  } catch (e) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.store_sales.product_option.request.failed', route: '/api/vendas/produtos/[id]/opcoes/[optionId]', method: 'POST', requestId: getRequestId(req), error: e });
    return jsonError(400, 'ERRO_ADICIONAR_VALOR', publicOptionValueError(e, submittedValue));
  }
}
