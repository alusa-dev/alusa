import { NextResponse } from 'next/server';

import { addSupportNote } from '@/features/support/actions/support-actions.server';
import { createSupportNoteSchema } from '@/features/support/actions/schemas';
import { requestAuditMetadata } from '@/features/support/audit/support-audit.server';
import { requireSupportApi } from '@/features/support/api/support-api.server';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_AGENT', 'SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-action-note',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = createSupportNoteSchema.parse(await req.json());
    const data = await addSupportNote({
      session: auth.session,
      ...body,
      requestMeta: requestAuditMetadata(req),
    });
    return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao adicionar nota' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
