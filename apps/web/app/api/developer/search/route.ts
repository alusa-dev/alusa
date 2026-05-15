import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { searchSupport } from '@/features/support/queries/support-dashboard';

export async function GET(req: Request) {
  const auth = await requireSupportApi(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const data = await searchSupport(q);
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}
