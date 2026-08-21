import { NextResponse } from 'next/server';
import { prisma } from '@/src/prisma';
import bcrypt from 'bcryptjs';
import {
  devSetPasswordInputDTOSchema,
  devSetPasswordResultDTOSchema,
} from '@/features/system/dtos';
import { revokeUserSessions } from '@/lib/auth-service';
import { mapDevSetPasswordResultToDTO } from '@/features/system/mappers';
import { isTestRouteEnabled, notFoundJson } from '@/lib/security/runtime-guards';

export async function POST(req: Request) {
  if (!isTestRouteEnabled()) {
    return notFoundJson();
  }
  const body = await req.json();
  const parsed = devSetPasswordInputDTOSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { email, password } = parsed.data;
  const user = await prisma.usuario.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
  if (!user) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  const pepper = process.env.BCRYPT_PEPPER || '';
  const senhaHash = await bcrypt.hash(password + pepper, rounds);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: user.id },
      data: { senhaHash, passwordChangedAt: new Date() },
    });
    await revokeUserSessions(user.id, tx);
  });
  return NextResponse.json(
    devSetPasswordResultDTOSchema.parse(
      mapDevSetPasswordResultToDTO({ ok: true, id: user.id }),
    ),
  );
}
