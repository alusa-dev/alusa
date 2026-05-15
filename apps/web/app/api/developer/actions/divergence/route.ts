import { NextResponse } from 'next/server';

import { markSupportDivergence } from '@/features/support/actions/support-actions.server';
import { supportEntityActionSchema } from '@/features/support/actions/schemas';
import { requireSupportApi } from '@/features/support/api/support-api.server';
import { requestAuditMetadata } from '@/features/support/audit/support-audit.server';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_FINANCE', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-action-divergence',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = supportEntityActionSchema.parse(await req.json());
    const data = await markSupportDivergence({
      session: auth.session,
      ...body,
      requestMeta: requestAuditMetadata(req),
    });
    return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao marcar divergência' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
