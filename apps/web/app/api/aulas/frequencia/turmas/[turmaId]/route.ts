import { NextRequest } from 'next/server';

import { listAttendanceWorkspaceQuerySchema } from '@/features/aulas/dtos';
import { getAttendanceTurmaWorkspace } from '@/src/server/aulas/frequencia/attendance-workspace.service';
import { handleAulasRouteError, json } from '@/src/server/aulas/route-utils';
import { canAccessAulas, getAulasSessionUser, resolveAulasAccessScope } from '@/src/server/aulas/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ turmaId: string }> },
) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const { turmaId } = await context.params;
    const { searchParams } = new URL(request.url);
    const query = listAttendanceWorkspaceQuerySchema.parse({
      date: searchParams.get('date') ?? undefined,
      search: undefined,
    });

    const scope = await resolveAulasAccessScope(user);
    return json(200, await getAttendanceTurmaWorkspace(scope, turmaId, query));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_OBTER_TURMA_FREQUENCIA');
  }
}
