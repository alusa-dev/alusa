import { NextResponse } from 'next/server';

import { createSupportCase } from '@/features/support/actions/support-actions.server';
import { createSupportCaseSchema } from '@/features/support/actions/schemas';
import { requireSupportApi } from '@/features/support/api/support-api.server';
import { requestAuditMetadata } from '@/features/support/audit/support-audit.server';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_AGENT', 'SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-action-case',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = createSupportCaseSchema.parse(await req.json());
    const data = await createSupportCase({
      session: auth.session,
      ...body,
      requestMeta: requestAuditMetadata(req),
    });
    return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao abrir caso' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
