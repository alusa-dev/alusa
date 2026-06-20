import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { cancelRenewalProcess } from '@/src/server/matriculas/renewal-process.service';
import { hasRenewalPermission } from '@/src/server/matriculas/renewal-permissions.service';

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
  const raw = await request.json().catch(() => null);
  const reason =
    raw && typeof raw === 'object' && typeof (raw as { reason?: unknown }).reason === 'string'
      ? (raw as { reason: string }).reason.trim()
      : null;

  try {
    const result = await cancelRenewalProcess(
      {
        contaId: user.contaId,
        processId: params.id,
        actorId: user.id,
        reason,
      },
      { prisma },
    );

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
      error instanceof Error ? error.message : 'Erro ao cancelar rematrícula.',
    );
  }
}
