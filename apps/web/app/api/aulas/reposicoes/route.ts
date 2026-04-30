import { NextRequest } from 'next/server';

import {
  createMakeupClassInputSchema,
  listMakeupClassesQuerySchema,
} from '@/features/aulas/dtos';
import {
  createMakeupClass,
  listMakeupClasses,
} from '@/src/server/aulas/reposicoes/makeup.service';
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
    const query = listMakeupClassesQuerySchema.parse({
      turmaId: searchParams.get('turmaId') ?? undefined,
      alunoId: searchParams.get('alunoId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
    });

    return json(200, await listMakeupClasses(user.contaId, query));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_LISTAR_REPOSICOES');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAulasSessionUser();
    if (!user) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!canAccessAulas(user)) return json(403, { error: 'SEM_PERMISSAO' });

    const body = createMakeupClassInputSchema.parse(await request.json());

    return json(201, await createMakeupClass(user.contaId, user.id, body));
  } catch (error) {
    return handleAulasRouteError(error, 'ERRO_AO_CRIAR_REPOSICAO');
  }
}
