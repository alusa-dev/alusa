import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authRateLimitAsync, ipFromRequest, rateLimitSubject } from '@/lib/rate-limit';
import { resetPasswordByToken } from '@/lib/auth-email-flow';
import { passwordPolicyMessage, passwordPolicyRegex } from '@/lib/password-policy';
import { rateLimitResponse } from '@/lib/security/rate-limit-response';

const bodySchema = z
  .object({
    token: z.string().min(20),
    password: z.string().regex(passwordPolicyRegex, passwordPolicyMessage),
    confirmPassword: z.string().regex(passwordPolicyRegex, passwordPolicyMessage),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Senhas não coincidem.',
  });

export async function POST(req: Request) {
  const ip = ipFromRequest(req);

  try {
    const body: unknown = await req.json();
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message || 'Dados inválidos.';
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const [ipLimit, tokenLimit] = await Promise.all([
      authRateLimitAsync(`auth-reset:ip:${await rateLimitSubject(ip)}`, 20, 15 * 60 * 1000),
      authRateLimitAsync(`auth-reset:token:${await rateLimitSubject(parsed.data.token)}`, 10, 15 * 60 * 1000),
    ]);
    if (!ipLimit.ok || !tokenLimit.ok) return rateLimitResponse(!ipLimit.ok ? ipLimit : tokenLimit, 10);

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
