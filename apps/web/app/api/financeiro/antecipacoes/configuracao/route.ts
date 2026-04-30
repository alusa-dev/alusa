import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import {
  getReceivableAnticipationConfiguration,
  updateAnticipationConfigurationInputDTOSchema,
  updateReceivableAnticipationConfiguration,
} from '@alusa/finance';
import { anticipationErrorResponse, json, requireFinanceUser } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const result = await getReceivableAnticipationConfiguration({ contaId: auth.user.contaId });
    if (!result.success) return anticipationErrorResponse(result.error);

    return json(200, { data: result.data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[API antecipacoes configuracao][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const input = updateAnticipationConfigurationInputDTOSchema.parse(await req.json());
    const result = await updateReceivableAnticipationConfiguration({
      contaId: auth.user.contaId,
      userId: auth.user.id,
      creditCardAutomaticEnabled: input.creditCardAutomaticEnabled,
    });

    if (!result.success) return anticipationErrorResponse(result.error);
    return json(200, { data: result.data });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'BODY_INVALIDO', details: error.flatten() });
    }
    console.error('[API antecipacoes configuracao][PUT]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
