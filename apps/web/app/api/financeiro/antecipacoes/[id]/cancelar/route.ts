import { NextRequest } from 'next/server';

import { cancelReceivableAnticipation } from '@alusa/finance';
import { anticipationErrorResponse, json, requireFinanceUser } from '../../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    if (!params.id) return json(400, { error: 'ID_OBRIGATORIO' });

    const result = await cancelReceivableAnticipation({
      contaId: auth.user.contaId,
      userId: auth.user.id,
      anticipationId: params.id,
    });

    if (!result.success) return anticipationErrorResponse(result.error);
    return json(200, { data: result.data });
  } catch (error) {
    console.error('[API antecipacoes cancelar][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
