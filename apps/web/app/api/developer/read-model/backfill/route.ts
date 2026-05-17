import { NextResponse } from 'next/server';
import { chargeReadModelService, refreshFinanceSummaryReadModel } from '@alusa/finance';

import { requireSupportApi } from '@/features/support/api/support-api.server';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    scope: 'developer-read-model-backfill',
    roles: ['SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({})) as { contaId?: string; limit?: number };
  if (!body.contaId) {
    return NextResponse.json({ success: false, error: 'CONTA_ID_OBRIGATORIO' }, { status: 422 });
  }

  const limit = Math.min(Math.max(Number(body.limit ?? 500), 1), 2000);
  const readModel = await chargeReadModelService.backfillChargeReadModel({
    contaId: body.contaId,
    limit,
  });

  let financeSummary = null;
  if (process.env.FIN_SUMMARY_READMODEL_ENABLED === 'true') {
    const now = new Date();
    financeSummary = await refreshFinanceSummaryReadModel({
      contaId: body.contaId,
      window: {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      },
      now,
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      contaId: body.contaId,
      limit,
      readModel,
      financeSummary,
    },
  }, { headers: { 'cache-control': 'no-store' } });
}
