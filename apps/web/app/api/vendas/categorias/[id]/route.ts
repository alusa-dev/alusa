import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { deleteCategory } from '@alusa/lib';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id } = await params;
    if (!id) return jsonError(400, 'ID_INVALIDO', 'ID da categoria é obrigatório');

    try {
      await deleteCategory(id, contaId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return jsonError(400, 'ERRO_DELETAR_CATEGORIA', (err as Error).message);
    }
  } catch (e) {
    return jsonError(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
