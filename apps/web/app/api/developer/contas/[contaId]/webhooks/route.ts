import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { getSupportAccount, listSupportWebhooks } from '@/features/support/queries/support-account';

export async function GET(req: Request, { params }: { params: { contaId: string } }) {
  const auth = await requireSupportApi(req);
  if (!auth.ok) return auth.response;

  const account = await getSupportAccount(params.contaId);
  if (!account) {
    return NextResponse.json(
      { success: false, error: 'Conta não encontrada' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }

  const data = await listSupportWebhooks(params.contaId);
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
