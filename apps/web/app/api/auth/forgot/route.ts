import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';
import { sendPasswordResetForEmail } from '@/lib/auth-email-flow';
import { rateLimitResponse } from '@/lib/security/rate-limit-response';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  const ip = ipFromRequest(req);

  try {
    const body: unknown = await req.json();
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    }

    const [ipLimit, emailLimit] = await Promise.all([
      authRateLimitAsync(`auth-forgot:ip:${await rateLimitSubject(ip)}`, 20, 15 * 60 * 1000),
      authRateLimitAsync(`auth-forgot:email:${await rateLimitSubject(parsed.data.email)}`, 5, 15 * 60 * 1000),
    ]);
    if (!ipLimit.ok || !emailLimit.ok) return rateLimitResponse(!ipLimit.ok ? ipLimit : emailLimit, 5);

    try {
      await sendPasswordResetForEmail(parsed.data.email, {
        ip,
        userAgent: req.headers.get('user-agent'),
      });
    } catch (error) {
      logApiOperationalEvent({
        severity: 'warn',
        eventName: 'auth.password_reset.delivery_failed',
        route: '/api/auth/forgot',
        method: 'POST',
        requestId: getRequestId(req),
        error,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logApiOperationalEvent({
      severity: 'warn',
      eventName: 'auth.password_reset.request_failed',
      route: '/api/auth/forgot',
      method: 'POST',
      requestId: getRequestId(req),
      error,
    });
    return NextResponse.json({ ok: true });
  }
}
