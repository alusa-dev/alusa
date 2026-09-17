import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCredentialsDetailed } from '@/lib/auth-service';
import { sendAccountReactivationForEmail } from '@/lib/auth-email-flow';
import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';
import { rateLimitResponse } from '@/lib/security/rate-limit-response';

const bodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

const GENERIC_FAILURE = { ok: false as const, reason: 'INVALID_CREDENTIALS' as const };

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ ok: false, reason: 'INVALID_INPUT' }, { status: 400 });
    }

    const ip = ipFromRequest(req);
    const ipSubject = await rateLimitSubject(ip);
    const emailSubject = await rateLimitSubject(parsed.data.email);
    const [ipLimit, emailLimit] = await Promise.all([
      authRateLimitAsync(`auth-login-validate:ip:${ipSubject}`, 10, 15 * 60 * 1000),
      authRateLimitAsync(`auth-login-validate:email:${emailSubject}`, 5, 15 * 60 * 1000),
    ]);
    if (!ipLimit.ok || !emailLimit.ok) {
      return rateLimitResponse(!ipLimit.ok ? ipLimit : emailLimit, !ipLimit.ok ? 10 : 5);
    }

    const result = await verifyCredentialsDetailed(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      if (result.reason === 'ACCOUNT_DEACTIVATED') {
        await sendAccountReactivationForEmail(parsed.data.email, {
          ip,
          userAgent: req.headers.get('user-agent'),
        });
      }

      if (result.reason === 'UNEXPECTED_ERROR') {
        return NextResponse.json({ ok: false, reason: 'UNEXPECTED_ERROR' }, { status: 503 });
      }

      return NextResponse.json(GENERIC_FAILURE, {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, reason: 'UNEXPECTED_ERROR' }, { status: 500 });
  }
}
