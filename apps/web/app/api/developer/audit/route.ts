import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { listSupportAudit } from '@/features/support/queries/support-account';

export async function GET(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-audit',
  });
  if (!auth.ok) return auth.response;

  const data = await listSupportAudit();
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
