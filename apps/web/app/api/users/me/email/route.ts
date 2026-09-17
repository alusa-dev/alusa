import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { resolveUserId } from '@/src/server/identity/user-profile-http.helpers';
import { changeEmailInputDTOSchema, changeEmailResultDTOSchema } from '@/features/users/dtos';
import { changeUserEmail } from '@/src/server/users/user-account.service';

export async function PATCH(req: Request) {
  try {
    const ip = ipFromRequest(req);
    const limiter = rateLimit(`account:email:${ip}`, 5, 30 * 60 * 1000);
    if (!limiter.ok) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
    }

    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = changeEmailInputDTOSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
    }

    const { newEmail, currentPassword } = parsed.data;
    const result = await changeUserEmail({ userId, newEmail, currentPassword });
    if (result.status === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });
    }
    if (result.status === 'SAME_EMAIL') {
      return NextResponse.json(
        { error: { fieldErrors: { newEmail: ['Este email ja esta em uso na sua conta'] } } },
        { status: 409 },
      );
    }

    if (result.status === 'EMAIL_IN_USE') {
      return NextResponse.json(
        { error: { fieldErrors: { newEmail: ['Este email ja esta associado a outra conta'] } } },
        { status: 409 },
      );
    }

    if (result.status === 'INVALID_PASSWORD') {
      return NextResponse.json(
        { error: { fieldErrors: { currentPassword: ['Senha atual incorreta'] } } },
        { status: 403 },
      );
    }

    return NextResponse.json(changeEmailResultDTOSchema.parse({ success: true, email: result.email }));
  } catch (error) {
    console.error('Error updating email:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
