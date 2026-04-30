import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { sendPasswordResetForEmail } from '@/lib/auth-email-flow';

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  const ip = ipFromRequest(req);
  const rl = rateLimit(`auth-forgot:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  }

  try {
    const body: unknown = await req.json();
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    }

    try {
      await sendPasswordResetForEmail(parsed.data.email, {
        ip,
        userAgent: req.headers.get('user-agent'),
      });
    } catch (error) {
      console.error('[auth][forgot-password-send-failed]', error);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[auth][forgot-password]', error);
    return NextResponse.json({ ok: true });
  }
}
