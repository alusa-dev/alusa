import { NextResponse } from 'next/server';
import { getChargeReadModelLag, getFinanceSummaryLag } from '@alusa/finance';

import { requireSupportApi } from '@/features/support/api/support-api.server';

export async function GET(req: Request) {
  const auth = await requireSupportApi(req, {
    scope: 'developer-read-model-health',
    roles: ['SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
  });
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const contaId = url.searchParams.get('contaId');
  if (!contaId) {
    return NextResponse.json({ success: false, error: 'CONTA_ID_OBRIGATORIO' }, { status: 422 });
  }

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
