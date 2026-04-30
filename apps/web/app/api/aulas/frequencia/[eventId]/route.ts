import { NextRequest } from 'next/server';

import { saveAttendanceInputSchema } from '@/features/aulas/dtos';
import {
  getAttendanceEventDetails,
  saveAttendanceForEvent,
} from '@/src/server/aulas/frequencia/attendance.service';
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
    return json(200, await getAttendanceEventDetails(user.contaId, eventId));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_OBTER_CHAMADA');
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const { eventId } = await context.params;
    const body = saveAttendanceInputSchema.parse(await request.json());

    return json(200, await saveAttendanceForEvent(user.contaId, eventId, user.id, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_SALVAR_CHAMADA');
  }
}
