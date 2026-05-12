import { NextRequest } from 'next/server';

import { updateExperimentalClassInputSchema } from '@/features/aulas/dtos';
import {
  getExperimentalClassDetails,
  updateExperimentalClass,
} from '@/src/server/aulas/experimentais/experimental.service';
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
    return json(200, await getExperimentalClassDetails(user.contaId, id));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_OBTER_AULA_EXPERIMENTAL');
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

    const body = updateExperimentalClassInputSchema.parse(await request.json());
    const { id } = await context.params;

    return json(200, await updateExperimentalClass(user.contaId, id, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_ATUALIZAR_AULA_EXPERIMENTAL');
  }
}