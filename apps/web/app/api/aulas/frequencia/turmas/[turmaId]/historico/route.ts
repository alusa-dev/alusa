import { NextRequest } from 'next/server';

import { listAttendanceQuerySchema } from '@/features/aulas/dtos';
import { listAttendanceHistoryByTurma } from '@/src/server/aulas/frequencia/attendance.service';
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
    const scope = await resolveAulasAccessScope(user);
    const query = listAttendanceQuerySchema.parse({
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
      turmaId: undefined,
      professorId: scope.professorId ?? searchParams.get('professorId') ?? undefined,
    });

    return json(200, await listAttendanceHistoryByTurma(user.contaId, turmaId, query));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_LISTAR_HISTORICO_DA_TURMA');
  }
}