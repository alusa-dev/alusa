import { NextResponse } from 'next/server';

import { requireGlobalAdminSessionForApi } from '@/features/global-admin/auth/session.server';
import { executeGlobalAdminAction } from '@/features/global-admin/actions/commands';

export async function POST(
  req: Request,
  { params }: { params: { action: string } },
) {
  const auth = await requireGlobalAdminSessionForApi();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const data = await executeGlobalAdminAction(params.action as never, body, {
      username: auth.session.username,
    });

    const status = data.success ? 200 : 422;
    return NextResponse.json({ success: data.success, data, error: data.success ? null : data.summary }, { status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 400 },
    );
  }
}
