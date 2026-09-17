import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { supportAccountRouteParamsSchema } from '@/features/support/actions/schemas';
import { getSupportAccount, listSupportWebhooks } from '@/features/support/queries/support-account';

export async function GET(req: Request, { params }: { params: Promise<{ contaId: string }> }) {
  const auth = await requireSupportApi(req);
  if (!auth.ok) return auth.response;
  const rawParams = supportAccountRouteParamsSchema.parse(await params);

  const account = await getSupportAccount(rawParams.contaId);
  if (!account) {
    return NextResponse.json(
      { success: false, error: 'Conta não encontrada' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }

  const data = await listSupportWebhooks(rawParams.contaId);
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
