import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { verifyEmailByToken } from '@/lib/auth-email-flow';

const bodySchema = z.object({
  token: z.string().min(20),
});

export async function POST(req: Request) {
  const ip = ipFromRequest(req);
  const rl = rateLimit(`auth-verify-email:${ip}`, 20, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  }

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

    const verified = await verifyEmailByToken(parsed.data.token);
    if (!verified) {
      return NextResponse.json({ error: 'Link inválido ou expirado.' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, email: verified.email });
  } catch (error) {
    console.error('[auth][verify-email]', error);
    return NextResponse.json({ error: 'Não foi possível confirmar o e-mail.' }, { status: 500 });
  }
}
