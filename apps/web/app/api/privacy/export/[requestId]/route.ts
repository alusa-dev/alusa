import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth-options';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user;
  if (!user?.id || !user.contaId) {
    return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
  }

  const { requestId } = await params;
  const request = await prisma.privacyRequest.findFirst({
    where: {
      id: requestId,
      contaId: user.contaId,
      OR: [{ userId: user.id }, { userId: null }],
    },
    select: {
      id: true,
      requestType: true,
      status: true,
      action: true,
      resultUrl: true,
      rejectedReason: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    },
  });

  if (!request) {
    return NextResponse.json({ error: 'Solicitacao nao encontrada.' }, { status: 404 });
  }

  return NextResponse.json({
    ...request,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
  });
}
