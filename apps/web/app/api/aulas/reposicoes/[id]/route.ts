import { NextRequest } from 'next/server';

import { updateMakeupClassInputSchema } from '@/features/aulas/dtos';
import { getMakeupClassDetails, updateMakeupClass } from '@/src/server/aulas/reposicoes/makeup.service';
import { handleAulasRouteError, json } from '@/src/server/aulas/route-utils';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const { id } = await context.params;
    return json(200, await getMakeupClassDetails(user.contaId, id));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_OBTER_REPOSICAO');
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const body = updateMakeupClassInputSchema.parse(await request.json());
    const { id } = await context.params;

    return json(200, await updateMakeupClass(user.contaId, id, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_ATUALIZAR_REPOSICAO');
  }
}
