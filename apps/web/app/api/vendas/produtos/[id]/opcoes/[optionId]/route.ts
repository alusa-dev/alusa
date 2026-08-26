import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { deleteProductOption, addOptionValue } from '@alusa/lib';

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
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

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
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId, optionId } = await Promise.resolve(context.params);
    const body = await req.json();

    submittedValue = typeof body.value === 'string' ? body.value : undefined;
    if (!body.value?.trim()) {
      return jsonError(422, 'DADOS_INVALIDOS', '"value" é obrigatório');
    }

    const value = await addOptionValue({ optionId, productId, contaId, value: body.value });
    return NextResponse.json({ data: value }, { status: 201 });
  } catch (e) {
    console.error('[vendas/produtos/opcoes/valores] Falha ao adicionar valor', e);
    return jsonError(400, 'ERRO_ADICIONAR_VALOR', publicOptionValueError(e, submittedValue));
  }
}
