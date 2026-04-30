import { NextRequest } from 'next/server';

import { listAttendanceQuerySchema } from '@/features/aulas/dtos';
import { listAttendanceHistory } from '@/src/server/aulas/frequencia/attendance.service';
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
    const query = listAttendanceQuerySchema.parse({
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      turmaId: searchParams.get('turmaId') ?? undefined,
      professorId: scope.professorId ?? searchParams.get('professorId') ?? undefined,
    });

    return json(200, await listAttendanceHistory(user.contaId, query));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_LISTAR_FREQUENCIA');
  }
}
