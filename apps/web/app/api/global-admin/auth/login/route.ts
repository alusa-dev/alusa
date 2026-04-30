import { NextResponse } from 'next/server';

import {
  globalAdminLoginRequestDTOSchema,
  globalAdminLoginResponseDTOSchema,
} from '@/features/global-admin/auth/dtos';
import { getGlobalAdminAuthConfig, validateGlobalAdminCredentials } from '@/features/global-admin/auth/credentials.server';
import { mapGlobalAdminSessionToDTO } from '@/features/global-admin/auth/mappers';
import {
  clearGlobalAdminAttempts,
  getGlobalAdminRateLimitState,
  registerGlobalAdminFailedAttempt,
} from '@/features/global-admin/auth/rate-limit.server';
import { attachGlobalAdminSession } from '@/features/global-admin/auth/session.server';

function getRequestKey(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'local';
}

export async function POST(req: Request) {
  try {
    getGlobalAdminAuthConfig();
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Configuração inválida' },
      { status: 503 },
    );
  }

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
    const valid = validateGlobalAdminCredentials(body);

    if (!valid) {
      registerGlobalAdminFailedAttempt(key);
      return NextResponse.json({ success: false, error: 'Credenciais inválidas' }, { status: 401 });
    }

    clearGlobalAdminAttempts(key);

    const response = NextResponse.json(
      globalAdminLoginResponseDTOSchema.parse({
        success: true,
        user: mapGlobalAdminSessionToDTO({
          username: body.username,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        }),
      }),
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );

    await attachGlobalAdminSession(response, body.username);
    return response;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 400 },
    );
  }
}
