import { NextRequest } from 'next/server';

import { updateCalendarEventInputSchema } from '@/features/aulas/dtos';
import {
  getAgendaEventDetails,
  updateAgendaEvent,
} from '@/src/server/aulas/agenda/agenda.service';
import { handleAulasRouteError, json } from '@/src/server/aulas/route-utils';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const { eventId } = await context.params;
    return json(200, await getAgendaEventDetails(user.contaId, eventId));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_OBTER_EVENTO');
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const body = updateCalendarEventInputSchema.parse(await request.json());
    const { eventId } = await context.params;

    return json(200, await updateAgendaEvent(user.contaId, eventId, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_ATUALIZAR_EVENTO');
  }
}
