import { NextRequest } from 'next/server';

import { createCalendarEventInputSchema, listCalendarEventsQuerySchema } from '@/features/aulas/dtos';
import { createAgendaEvent, listAgendaEvents } from '@/src/server/aulas/agenda/agenda.service';
import {
  buildAgendaServerTimingHeader,
  handleAulasRouteError,
  json,
} from '@/src/server/aulas/route-utils';
import { canAccessAulas, getAulasSessionUser, resolveAulasAccessScope } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const timings: Record<string, number> = {};
  const wallStart = performance.now();

  try {
    let mark = performance.now();
    const user = await getAulasSessionUser();
    timings.auth = performance.now() - mark;

    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    mark = performance.now();
    const scope = await resolveAulasAccessScope(user);
    const { searchParams } = new URL(request.url);
    const query = listCalendarEventsQuerySchema.parse({
      start: searchParams.get('start') ?? undefined,
      end: searchParams.get('end') ?? undefined,
      turmaId: searchParams.get('turmaId') ?? undefined,
      professorId: scope.professorId ?? searchParams.get('professorId') ?? undefined,
      salaId: searchParams.get('salaId') ?? undefined,
      type: searchParams.get('type') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      viewMode: searchParams.get('viewMode') ?? undefined,
      includeResources: searchParams.get('includeResources') ?? undefined,
    });
    timings.scope = performance.now() - mark;

    const payload = await listAgendaEvents(user.contaId, query, timings);
    timings.total = performance.now() - wallStart;

    return json(200, payload, {
      'server-timing': buildAgendaServerTimingHeader(timings),
    });
  } catch (error) {
    timings.total = performance.now() - wallStart;
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
