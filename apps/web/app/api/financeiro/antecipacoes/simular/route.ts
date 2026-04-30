import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import {
  anticipationTargetInputDTOSchema,
  simulateReceivableAnticipation,
} from '@alusa/finance';
import { anticipationErrorResponse, json, requireFinanceUser } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const target = anticipationTargetInputDTOSchema.parse(await req.json());
    const result = await simulateReceivableAnticipation({
      contaId: auth.user.contaId,
      target,
    });

    if (!result.success) return anticipationErrorResponse(result.error);
    return json(200, { data: result.data });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'BODY_INVALIDO', details: error.flatten() });
    }
    console.error('[API antecipacoes simular][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
