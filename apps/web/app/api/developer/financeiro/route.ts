import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { listSupportAccountFinance } from '@/features/support/queries/support-account';

export async function GET(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_VIEWER', 'SUPPORT_AGENT', 'SUPPORT_FINANCE', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-finance',
  });
  if (!auth.ok) return auth.response;

  const data = await listSupportAccountFinance();
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
