import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import { resolvePostVerificationRedirect } from '@/lib/safe-redirect';
import { rateLimitResponse } from '@/lib/security/rate-limit-response';

const bodySchema = z.object({
  callbackUrl: z.string().trim().optional().nullable(),
});

export async function POST(req: Request) {
  const ip = ipFromRequest(req);

  try {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }

    const limiter = await authRateLimitAsync(
      `auth-verify-email-resend:user:${await rateLimitSubject(`${session.user.id}:${ip}`)}`,
      5,
      15 * 60 * 1000,
    );
    if (!limiter.ok) return rateLimitResponse(limiter, 5);

    if (session.user.emailVerified) {
      return NextResponse.json({ ok: true, alreadyVerified: true });
    }

    const callbackUrl = resolvePostVerificationRedirect(
      parsed.success ? parsed.data.callbackUrl : null,
      session.user.role,
      (session.user as { financeStatus?: string | null }).financeStatus,
    );

    await sendEmailVerificationForUser(session.user.id, {
      ip,
      userAgent: req.headers.get('user-agent'),
    }, {
      callbackUrl,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[auth][verify-email-resend]', error);
    return NextResponse.json({ error: 'Não foi possível reenviar o e-mail.' }, { status: 503 });
  }
}
