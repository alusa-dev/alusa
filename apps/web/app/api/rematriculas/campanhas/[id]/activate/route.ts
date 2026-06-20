import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { activateRenewalCampaign } from '@/src/server/matriculas/renewal-management.service';
import { hasRenewalPermission } from '@/src/server/matriculas/renewal-permissions.service';

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!hasRenewalPermission(user.role, 'renewal.campaign.manage')) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para ativar campanhas.');
  }

  try {
    const { id } = await context.params;
    const result = await activateRenewalCampaign(
      { contaId: user.contaId, actorId: user.id, campaignId: id },
      { prisma },
    );
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'CAMPANHA_NAO_ENCONTRADA') {
      return jsonError(404, 'CAMPANHA_NAO_ENCONTRADA', 'Campanha não encontrada.');
    }
    return jsonError(
      500,
      'ERRO_ATIVAR_CAMPANHA',
      error instanceof Error ? error.message : 'Erro ao ativar campanha.',
    );
  }
}
