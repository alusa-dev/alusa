import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';
import { verifyEmailByToken } from '@/lib/auth-email-flow';
import { rateLimitResponse } from '@/lib/security/rate-limit-response';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { acceptInviteApplication } from '@/src/server/users/invite-acceptance.application-service';

const bodySchema = z.object({
  token: z.string().min(20),
  inviteToken: z.string().min(1).max(512).optional(),
});

export async function POST(req: Request) {
  const ip = ipFromRequest(req);

  try {
    const rawBody = await req.text().catch(() => '');
    let body: unknown = {};

    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        return NextResponse.json({ error: 'Token inválido.' }, { status: 400 });
      }
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Token inválido.' }, { status: 400 });
    }

    const [ipLimit, tokenLimit] = await Promise.all([
      authRateLimitAsync(`auth-verify-email:ip:${await rateLimitSubject(ip)}`, 30, 15 * 60 * 1000),
      authRateLimitAsync(`auth-verify-email:token:${await rateLimitSubject(parsed.data.token)}`, 10, 15 * 60 * 1000),
    ]);
    if (!ipLimit.ok || !tokenLimit.ok) return rateLimitResponse(!ipLimit.ok ? ipLimit : tokenLimit, 10);

    const verified = await verifyEmailByToken(parsed.data.token);
    if (!verified) {
      return NextResponse.json({ error: 'Link inválido ou expirado.' }, { status: 400 });
    }

    if (!parsed.data.inviteToken) {
      return NextResponse.json({ ok: true, email: verified.email, context: verified.context });
    }

    const inviteResult = await acceptInviteApplication({
      input: { token: parsed.data.inviteToken, email: verified.email },
      ip,
      userAgent: req.headers.get('user-agent'),
      authenticatedUserId: verified.id,
      sessionEmail: verified.email,
      sessionAuthContext: verified.context,
    });
    if (inviteResult.status !== 200) {
      const errorBody = inviteResult.body;
      return NextResponse.json({
        ok: true,
        email: verified.email,
        inviteAccepted: false,
        inviteError: typeof errorBody.error === 'string' ? errorBody.error : 'Não foi possível concluir o convite.',
      });
    }

    return NextResponse.json({ ok: true, email: verified.email, inviteAccepted: true, context: verified.context });
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'auth.verify_email.request_failed',
      route: '/api/auth/verify-email',
      method: 'POST',
      requestId: getRequestId(req),
      error,
    });
    return NextResponse.json({ error: 'Não foi possível confirmar o e-mail.' }, { status: 500 });
  }
}
