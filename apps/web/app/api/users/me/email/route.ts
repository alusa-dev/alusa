import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';

import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { resolveUserId } from '../helpers';
import { changeEmailInputDTOSchema, changeEmailResultDTOSchema } from '@/features/users/dtos';

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

    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { email: true, senhaHash: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });
    }

    const { newEmail, currentPassword } = parsed.data;
    if (user.email.toLowerCase() === newEmail) {
      return NextResponse.json(
        { error: { fieldErrors: { newEmail: ['Este email ja esta em uso na sua conta'] } } },
        { status: 409 },
      );
    }

    const emailInUse = await prisma.usuario.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (emailInUse && emailInUse.id !== userId) {
      return NextResponse.json(
        { error: { fieldErrors: { newEmail: ['Este email ja esta associado a outra conta'] } } },
        { status: 409 },
      );
    }

    const pepper = process.env.BCRYPT_PEPPER || '';
    const validPassword = await bcrypt.compare(currentPassword + pepper, user.senhaHash);
    if (!validPassword) {
      return NextResponse.json(
        { error: { fieldErrors: { currentPassword: ['Senha atual incorreta'] } } },
        { status: 403 },
      );
    }

    await prisma.usuario.update({
      where: { id: userId },
      data: { email: newEmail },
    });

    return NextResponse.json(changeEmailResultDTOSchema.parse({ success: true, email: newEmail }));
  } catch (error) {
    console.error('Error updating email:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
