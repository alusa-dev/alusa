import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { getRenewalProcessDetail } from '@/src/server/matriculas/renewal-management.service';
import { hasRenewalPermission } from '@/src/server/matriculas/renewal-permissions.service';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!hasRenewalPermission(user.role, 'renewal.portal.view')) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para ver processos.');
  }

  try {
    const { id } = await context.params;
    const process = await getRenewalProcessDetail({ contaId: user.contaId, processId: id }, { prisma });
    return NextResponse.json({ process }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'REMATRICULA_NAO_ENCONTRADA') {
      return jsonError(404, 'REMATRICULA_NAO_ENCONTRADA', 'Processo de rematrícula não encontrado.');
    }
    return jsonError(
      500,
      'ERRO_DETALHAR_REMATRICULA',
      error instanceof Error ? error.message : 'Erro ao carregar processo.',
    );
  }
}
