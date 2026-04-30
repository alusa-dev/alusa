import { NextResponse } from 'next/server';

import { requireGlobalAdminSessionForApi } from '@/features/global-admin/auth/session.server';
import { searchGlobalAdmin } from '@/features/global-admin/search/queries';

export async function GET(req: Request) {
  const auth = await requireGlobalAdminSessionForApi();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const data = await searchGlobalAdmin(q);
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
