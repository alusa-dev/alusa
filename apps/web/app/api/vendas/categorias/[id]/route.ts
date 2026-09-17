import { NextResponse } from 'next/server';
import { deleteCategory } from '@alusa/lib/services/category.service';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id } = await params;
    if (!id) return jsonError(400, 'ID_INVALIDO', 'ID da categoria é obrigatório');

    try {
      await deleteCategory(id, contaId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return jsonError(400, 'ERRO_DELETAR_CATEGORIA', (err as Error).message);
    }
  } catch (e) {
    return jsonError(500, 'ERRO_INTERNO', 'Não foi possível atualizar a categoria.');
  }
}
