import { NextResponse } from 'next/server';

import { requireGlobalAdminSessionForApi } from '@/features/global-admin/auth/session.server';
import { listGlobalAdminAudit } from '@/features/global-admin/audit/queries';

export async function GET(req: Request) {
  const auth = await requireGlobalAdminSessionForApi();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const data = await listGlobalAdminAudit({
    tenantId: url.searchParams.get('tenantId') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    actorIdentifier: url.searchParams.get('actorIdentifier') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
