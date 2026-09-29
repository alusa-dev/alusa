import { NextRequest } from 'next/server';

import { listAttendanceWorkspaceQuerySchema } from '@/features/lessons/dtos';
import { listAttendanceWorkspace } from '@/src/server/lessons/attendance/attendance-workspace.service';
import { handleAulasRouteError, json } from '@/src/server/lessons/route-utils';
import { canAccessAulas, getAulasSessionUser, resolveAulasAccessScope } from '@/src/server/lessons/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const { searchParams } = new URL(request.url);
    const query = listAttendanceWorkspaceQuerySchema.parse({
      date: searchParams.get('date') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    });

    const scope = await resolveAulasAccessScope(user);
    return json(200, await listAttendanceWorkspace(scope, query));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_LISTAR_TURMAS_FREQUENCIA');
  }
}
