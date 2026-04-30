import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';

import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { resolveUserId } from '../helpers';
import { changePasswordInputDTOSchema, simpleSuccessResultDTOSchema } from '@/features/users/dtos';

export async function PATCH(req: Request) {
  try {
    const ip = ipFromRequest(req);
    const limiter = rateLimit(`account:password:${ip}`, 10, 10 * 60 * 1000);
    if (!limiter.ok) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
    }

    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = changePasswordInputDTOSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
    }

    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { senhaHash: true },
    });

    if (!user?.senhaHash) {
      return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });
    }

    const pepper = process.env.BCRYPT_PEPPER || '';
    const isValid = await bcrypt.compare(parsed.data.currentPassword + pepper, user.senhaHash);
    if (!isValid) {
      return NextResponse.json(
        { error: { fieldErrors: { currentPassword: ['Senha atual incorreta'] } } },
        { status: 403 },
      );
    }

    const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
    const newHash = await bcrypt.hash(parsed.data.newPassword + pepper, rounds);

    await prisma.usuario.update({
      where: { id: userId },
      data: { senhaHash: newHash },
    });

    return NextResponse.json(simpleSuccessResultDTOSchema.parse({ success: true }));
  } catch (error) {
    console.error('Error updating password:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
