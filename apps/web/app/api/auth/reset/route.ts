import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { resetPasswordByToken } from '@/lib/auth-email-flow';

const bodySchema = z
  .object({
    token: z.string().min(20),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Senhas não coincidem.',
  });

export async function POST(req: Request) {
  const ip = ipFromRequest(req);
  const rl = rateLimit(`auth-reset:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  }

  try {
    const body: unknown = await req.json();
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message || 'Dados inválidos.';
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    try {
      const result = await resetPasswordByToken({
        token: parsed.data.token,
        password: parsed.data.password,
      });

      if (!result) {
        return NextResponse.json({ error: 'Link inválido ou expirado.' }, { status: 400 });
      }

      return NextResponse.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível redefinir a senha.';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (error) {
    console.error('[auth][reset-password]', error);
    return NextResponse.json({ error: 'Não foi possível redefinir a senha.' }, { status: 500 });
  }
}
