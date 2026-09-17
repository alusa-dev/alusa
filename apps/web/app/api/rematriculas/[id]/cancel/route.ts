import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { cancelRenewalProcessFromHttp } from '@/src/server/matriculas/renewal-http-commands.service';
import { hasRenewalPermission } from '@/src/server/matriculas/renewal-permissions.service';
import { cancelRenewalInputDTOSchema } from '@/features/cadastro/rematriculas/dtos';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!hasRenewalPermission(user.role, 'renewal.process.cancel')) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para cancelar rematrícula.');
  }

  const params = await context.params;
  const parsed = cancelRenewalInputDTOSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(
      422,
      'MOTIVO_CANCELAMENTO_OBRIGATORIO',
      'Informe o motivo do cancelamento do próximo ciclo.',
    );
  }
  const { reason } = parsed.data;

  try {
    const result = await cancelRenewalProcessFromHttp({
        contaId: user.contaId,
        processId: params.id,
        actorId: user.id,
        reason,
      });

    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REMATRICULA_NAO_ENCONTRADA') {
      return jsonError(404, 'REMATRICULA_NAO_ENCONTRADA', 'Rematrícula não encontrada.');
    }
    if (error instanceof Error && error.message === 'REMATRICULA_NAO_CANCELAVEL') {
      return jsonError(409, 'REMATRICULA_NAO_CANCELAVEL', 'Esta rematrícula não pode ser cancelada.');
    }

    return jsonError(
      500,
      'ERRO_CANCELAR_REMATRICULA',
      'Erro ao cancelar rematrícula.',
    );
  }
}
