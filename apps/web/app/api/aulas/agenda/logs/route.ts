import { NextRequest } from 'next/server';

import { listAgendaOperationLogsQuerySchema } from '@/features/aulas/dtos';
import { listAgendaLogs } from '@/src/server/aulas/agenda/agenda.service';
import { handleAulasRouteError, json } from '@/src/server/aulas/route-utils';
import { canAccessAulas, getAulasSessionUser } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const { searchParams } = new URL(request.url);
    const query = listAgendaOperationLogsQuerySchema.parse({
      limit: searchParams.get('limit') ?? undefined,
    });

    return json(200, await listAgendaLogs(user.contaId, query.limit));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_LISTAR_LOGS_AGENDA');
  }
}
