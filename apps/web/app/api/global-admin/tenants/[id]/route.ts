import { NextResponse } from 'next/server';

import { requireGlobalAdminSessionForApi } from '@/features/global-admin/auth/session.server';
import { getGlobalAdminTenant360 } from '@/features/global-admin/tenants/queries';

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireGlobalAdminSessionForApi();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const windowDays = Number(url.searchParams.get('windowDays') ?? '7');

  try {
    const data = await getGlobalAdminTenant360(params.id, windowDays);
    return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }
}
