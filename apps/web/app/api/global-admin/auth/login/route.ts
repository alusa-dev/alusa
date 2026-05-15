import { NextResponse } from 'next/server';

import {
  globalAdminLoginRequestDTOSchema,
  globalAdminLoginResponseDTOSchema,
} from '@/features/global-admin/auth/dtos';
import { mapGlobalAdminSessionToDTO } from '@/features/global-admin/auth/mappers';
import {
  clearGlobalAdminAttempts,
  getGlobalAdminRateLimitState,
  registerGlobalAdminFailedAttempt,
} from '@/features/global-admin/auth/rate-limit.server';
import { attachGlobalAdminSession } from '@/features/global-admin/auth/session.server';
import { recordSupportAudit } from '@/features/support/audit/support-audit.server';
import { authenticateSupportUser } from '@/features/support/auth/support-users.server';

function getRequestKey(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'local';
}

export async function POST(req: Request) {
  const key = getRequestKey(req);
  const rate = getGlobalAdminRateLimitState(key);
  if (rate.blocked) {
    return NextResponse.json(
      { success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' },
      { status: 429 },
    );
  }

  try {
    const body = globalAdminLoginRequestDTOSchema.parse(await req.json());
    const supportUser = await authenticateSupportUser(body);

    if (!supportUser) {
      registerGlobalAdminFailedAttempt(key);
      return NextResponse.json({ success: false, error: 'Credenciais inválidas' }, { status: 401 });
    }

    clearGlobalAdminAttempts(key);

    const response = NextResponse.json(
      globalAdminLoginResponseDTOSchema.parse({
        success: true,
        user: mapGlobalAdminSessionToDTO({
          username: supportUser.username,
          supportUserId: supportUser.id,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          role: supportUser.role,
        }),
      }),
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );

    await attachGlobalAdminSession(response, supportUser.username, {
      supportUserId: supportUser.id,
      role: supportUser.role,
    });
    await recordSupportAudit({
      actorId: supportUser.id,
      actorUsername: supportUser.username,
      actorRole: supportUser.role,
      action: 'support.auth.login',
      ip: key,
      userAgent: req.headers.get('user-agent') ?? null,
      metadata: { authSource: supportUser.id ? 'support_user' : 'env_fallback' },
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 400 },
    );
  }
}
