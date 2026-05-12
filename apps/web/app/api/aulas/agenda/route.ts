import { NextRequest } from 'next/server';

import { createCalendarEventInputSchema, listCalendarEventsQuerySchema } from '@/features/aulas/dtos';
import { createAgendaEvent, listAgendaEvents } from '@/src/server/aulas/agenda/agenda.service';
import { handleAulasRouteError, json } from '@/src/server/aulas/route-utils';
import { canAccessAulas, getAulasSessionUser, resolveAulasAccessScope } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const { searchParams } = new URL(request.url);
    const scope = await resolveAulasAccessScope(user);
    const query = listCalendarEventsQuerySchema.parse({
      start: searchParams.get('start') ?? undefined,
      end: searchParams.get('end') ?? undefined,
      turmaId: searchParams.get('turmaId') ?? undefined,
      professorId: scope.professorId ?? searchParams.get('professorId') ?? undefined,
      salaId: searchParams.get('salaId') ?? undefined,
      type: searchParams.get('type') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      viewMode: searchParams.get('viewMode') ?? undefined,
      timelineGroupBy: searchParams.get('timelineGroupBy') ?? undefined,
      includeResources: searchParams.get('includeResources') ?? undefined,
    });

    return json(200, await listAgendaEvents(user.contaId, query));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_LISTAR_AGENDA');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const body = createCalendarEventInputSchema.parse(await request.json());

    return json(201, await createAgendaEvent(user.contaId, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_CRIAR_EVENTO');
  }
}
