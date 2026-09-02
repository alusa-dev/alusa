import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { auditActorFromSession, recordSupportAudit, requestAuditMetadata } from '@/features/support/audit/support-audit.server';
import { createSupportUser, listSupportUsers } from '@/features/support/auth/support-users.server';

const createAdminUserSchema = z.object({
  username: z.string().trim().min(3).max(80),
  email: z.string().email().max(320).nullable().optional(),
  password: z.string().min(10).max(512),
  role: z.enum(['READ_ONLY', 'SUPPORT', 'FINANCE_OPS', 'ENGINEERING', 'OWNER']),
});

export async function GET(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'admin-support-users',
  });
  if (!auth.ok) return auth.response;

  const data = await listSupportUsers();
  return NextResponse.json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'admin-support-users',
  });
  if (!auth.ok) return auth.response;

  try {
    const body = createAdminUserSchema.parse(await req.json());
    const data = await createSupportUser(body);
    await recordSupportAudit({
      ...auditActorFromSession(auth.session),
      ...requestAuditMetadata(req),
      action: 'support.user.create',
      entityType: 'ADMIN_USER',
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
