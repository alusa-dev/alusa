import { NextRequest } from 'next/server';

import { rebuildAgendaWindowInputSchema } from '@/features/aulas/dtos';
import { rebuildAgendaWindow } from '@/src/server/aulas/agenda/agenda.service';
import { handleAulasRouteError, json } from '@/src/server/aulas/route-utils';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

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
