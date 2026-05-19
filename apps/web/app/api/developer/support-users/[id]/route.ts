import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { auditActorFromSession, recordSupportAudit, requestAuditMetadata } from '@/features/support/audit/support-audit.server';
import { updateSupportUserSchema } from '@/features/support/auth/schemas';
import { updateSupportUser } from '@/features/support/auth/support-users.server';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-support-users',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = updateSupportUserSchema.parse(await req.json());
    const data = await updateSupportUser({ id: rawParams.id, ...body });
    await recordSupportAudit({
      ...auditActorFromSession(auth.session),
      ...requestAuditMetadata(req),
      action: 'support.user.update',
      entityType: 'SUPPORT_USER',
      entityId: data.id,
      reason: 'Gerenciamento interno de permissões',
      after: data,
    });
    return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao atualizar usuário interno' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
