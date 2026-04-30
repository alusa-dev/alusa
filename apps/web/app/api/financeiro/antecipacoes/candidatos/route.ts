import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import {
  listAnticipationCandidatesQueryDTOSchema,
  listReceivableAnticipationCandidates,
} from '@alusa/finance';
import { anticipationErrorResponse, json, requireFinanceUser } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const query = listAnticipationCandidatesQueryDTOSchema.parse({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      billingType: searchParams.get('billingType') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    });

    const result = await listReceivableAnticipationCandidates({
      contaId: auth.user.contaId,
      page: query.page,
      pageSize: query.pageSize,
      billingType: query.billingType,
      search: query.search,
    });

    if (!result.success) return anticipationErrorResponse(result.error);
    return json(200, result.data);
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'QUERY_INVALIDA', details: error.flatten() });
    }
    console.error('[API antecipacoes candidatos][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
