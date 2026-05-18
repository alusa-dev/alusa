import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { usersCountResultDTOSchema } from '@/features/users/dtos';

export async function GET() {
  if (process.env.NODE_ENV === 'production' || process.env.TEST_ROUTES_ENABLED !== 'true') {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  const count = await prisma.usuario.count();
  return NextResponse.json(usersCountResultDTOSchema.parse({ count }));
}
