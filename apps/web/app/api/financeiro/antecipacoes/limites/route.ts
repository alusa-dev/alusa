import { getReceivableAnticipationLimits } from '@alusa/finance';
import { anticipationErrorResponse, json, requireFinanceUser } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const result = await getReceivableAnticipationLimits({ contaId: auth.user.contaId });
    if (!result.success) return anticipationErrorResponse(result.error);

    return json(200, { data: result.data, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[API antecipacoes limites][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
