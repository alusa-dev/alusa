import { NextRequest } from 'next/server';

import { rebuildAgendaWindowInputSchema } from '@/features/lessons/dtos';
import { rebuildAgendaWindow } from '@/src/server/lessons/agenda/agenda.service';
import { handleAulasRouteError, json } from '@/src/server/lessons/route-utils';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/lessons/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const body = rebuildAgendaWindowInputSchema.parse(await request.json().catch(() => ({})));

    return json(200, await rebuildAgendaWindow(user.contaId, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_RECONSTRUIR_AGENDA');
  }
}
