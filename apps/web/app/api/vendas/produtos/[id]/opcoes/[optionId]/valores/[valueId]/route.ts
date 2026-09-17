import { NextResponse } from 'next/server';
import { deleteOptionValue } from '@alusa/lib/services/product-option.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string; optionId: string; valueId: string } | Promise<{ id: string; optionId: string; valueId: string }>;
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId, optionId, valueId } = await Promise.resolve(context.params);
    await deleteOptionValue(valueId, optionId, productId, contaId);
    return NextResponse.json({ success: true });
  } catch (e) {
    return jsonError(400, 'ERRO_DELETAR_VALOR', (e as Error).message);
  }
}
