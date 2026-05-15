import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { auditActorFromSession, recordSupportAudit, requestAuditMetadata } from '@/features/support/audit/support-audit.server';
import { createSupportUserSchema } from '@/features/support/auth/schemas';
import { createSupportUser, listSupportUsers } from '@/features/support/auth/support-users.server';

export async function GET(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-support-users',
  });
  if (!auth.ok) return auth.response;

  const data = await listSupportUsers();
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'developer-support-users',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = createSupportUserSchema.parse(await req.json());
    const data = await createSupportUser(body);
    await recordSupportAudit({
      ...auditActorFromSession(auth.session),
      ...requestAuditMetadata(req),
      action: 'support.user.create',
      entityType: 'SUPPORT_USER',
      entityId: data.id,
      reason: 'Gerenciamento interno de permissões',
      after: { ...data, password: '[mascarado]' },
    });
    return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro ao criar usuário interno' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
