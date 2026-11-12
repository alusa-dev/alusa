import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { expireContratosResultDTOSchema } from '@/features/contracts/dtos';

export async function POST(_request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  return NextResponse.json(expireContratosResultDTOSchema.parse({ updated: 0 }));
}
