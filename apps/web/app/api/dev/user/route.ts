import { NextResponse } from 'next/server';
import { prisma } from '@/src/prisma';
import { devUserQueryDTOSchema, devUserResultDTOSchema } from '@/features/system/dtos';
import { mapDevUserResultToDTO } from '@/features/system/mappers';
import { isTestRouteEnabled, notFoundJson } from '@/lib/security/runtime-guards';

export async function GET(req: Request) {
  if (!isTestRouteEnabled()) {
    return notFoundJson();
  }
  const { searchParams } = new URL(req.url);
  const parsedQuery = devUserQueryDTOSchema.safeParse({
    email: searchParams.get('email') ?? undefined,
  });
  if (!parsedQuery.success) return NextResponse.json({ error: 'missing_email' }, { status: 400 });
  const { email } = parsedQuery.data;
  const user = await prisma.usuario.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } }, select: { id: true, email: true, nome: true, role: true } });
  if (!user) {
    return NextResponse.json(
      devUserResultDTOSchema.parse(mapDevUserResultToDTO({ exists: false })),
      { status: 200 },
    );
  }
  return NextResponse.json(
    devUserResultDTOSchema.parse(mapDevUserResultToDTO({ exists: true, user })),
    { status: 200 },
  );
}
