import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCredentialsDetailed } from '@/lib/auth-service';
import { sendAccountReactivationForEmail } from '@/lib/auth-email-flow';
import { ipFromRequest } from '@/lib/rate-limit';

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ ok: false, reason: 'INVALID_INPUT' }, { status: 400 });
    }

    const result = await verifyCredentialsDetailed(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      if (result.reason === 'ACCOUNT_DEACTIVATED') {
        await sendAccountReactivationForEmail(parsed.data.email, {
          ip: ipFromRequest(req),
          userAgent: req.headers.get('user-agent'),
        });
      }

      const status = result.reason === 'UNEXPECTED_ERROR'
        ? 500
        : result.reason === 'ACCOUNT_UNAVAILABLE' || result.reason === 'USER_INACTIVE' || result.reason === 'ACCOUNT_DEACTIVATED'
          ? 403
          : 401;

      return NextResponse.json(result, { status });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, reason: 'UNEXPECTED_ERROR' }, { status: 500 });
  }
}