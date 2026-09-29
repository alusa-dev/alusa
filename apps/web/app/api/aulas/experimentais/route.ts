import { NextRequest } from 'next/server';

import { createExperimentalClassInputSchema } from '@/features/lessons/dtos';
import { createExperimentalClass } from '@/src/server/lessons/experimental-classes/experimental.service';
import { handleAulasRouteError, json } from '@/src/server/lessons/route-utils';
import { assertAulasWriteAccess, canAccessAulas, getAulasSessionUser } from '@/src/server/lessons/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });
    await assertAulasWriteAccess(user);

    const body = createExperimentalClassInputSchema.parse(await request.json());

    return json(201, await createExperimentalClass(user.contaId, user.id, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_CRIAR_AULA_EXPERIMENTAL');
  }
}
