import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { getSupportAccount } from '@/features/support/queries/support-account';

export async function GET(req: Request, { params }: { params: Promise<{ contaId: string }> }) {
    const rawParams = await params;
  const auth = await requireSupportApi(req);
  if (!auth.ok) return auth.response;

  const data = await getSupportAccount(rawParams.contaId);
  if (!data) {
    return NextResponse.json(
      { success: false, error: 'Conta não encontrada' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
