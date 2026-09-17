import { NextResponse } from 'next/server';
import { getChargeReadModelLag, getFinanceSummaryLag } from '@alusa/finance';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { supportReadModelHealthQuerySchema } from '@/features/support/actions/schemas';

export async function GET(req: Request) {
  const auth = await requireSupportApi(req, {
    scope: 'admin-read-model-health',
    roles: ['SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
  });
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const query = supportReadModelHealthQuerySchema.safeParse({
    contaId: url.searchParams.get('contaId'),
  });
  if (!query.success) {
    return NextResponse.json({ success: false, error: 'CONTA_ID_OBRIGATORIO' }, { status: 422 });
  }
  const { contaId } = query.data;

  const [chargeReadModel, financeSummary] = await Promise.all([
    getChargeReadModelLag({ contaId }),
    getFinanceSummaryLag({ contaId }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      contaId,
      chargeReadModel,
      financeSummary,
    },
  }, { headers: { 'cache-control': 'no-store' } });
}
