import { NextResponse } from 'next/server';

import { requireGlobalAdminSessionForApi } from '@/features/global-admin/auth/session.server';
import { getGlobalAdminDashboard } from '@/features/global-admin/dashboard/queries';

export async function GET(req: Request) {
  const auth = await requireGlobalAdminSessionForApi();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const windowDays = Number(url.searchParams.get('windowDays') ?? '7');
  const data = await getGlobalAdminDashboard(windowDays);
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
