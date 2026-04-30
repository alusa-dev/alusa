import { NextResponse } from 'next/server';

import { clearGlobalAdminSession } from '@/features/global-admin/auth/session.server';

export async function POST() {
  const response = NextResponse.json(
    { success: true },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
  clearGlobalAdminSession(response);
  return response;
}
