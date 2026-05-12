import { NextRequest } from 'next/server';

import { createExperimentalClassInputSchema } from '@/features/aulas/dtos';
import { createExperimentalClass } from '@/src/server/aulas/experimentais/experimental.service';
import { handleAulasRouteError, json } from '@/src/server/aulas/route-utils';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const body = createExperimentalClassInputSchema.parse(await request.json());

    return json(201, await createExperimentalClass(user.contaId, user.id, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_CRIAR_AULA_EXPERIMENTAL');
  }
}