import { NextResponse } from 'next/server';
import { chargeReadModelService, refreshFinanceSummaryReadModel } from '@alusa/finance';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { supportReadModelBackfillSchema } from '@/features/support/actions/schemas';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    scope: 'admin-read-model-backfill',
    roles: ['SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
  });
  if (!auth.ok) return auth.response;

  const body = supportReadModelBackfillSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ success: false, error: 'PAYLOAD_INVALIDO' }, { status: 422 });
  }

  const { contaId, limit } = body.data;
  const readModel = await chargeReadModelService.backfillChargeReadModel({
    contaId,
    limit,
  });

  let financeSummary = null;
  if (process.env.FIN_SUMMARY_READMODEL_ENABLED === 'true') {
    const now = new Date();
    financeSummary = await refreshFinanceSummaryReadModel({
      contaId,
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
      contaId,
      limit,
      readModel,
      financeSummary,
    },
  }, { headers: { 'cache-control': 'no-store' } });
}
