import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { expireContratosResultDTOSchema } from '@/features/contratos/dtos';

export async function POST(_request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  try {
    const agora = new Date();

    const expirando = await prisma.contrato.findMany({
      where: {
        status: 'PENDENTE',
        tokenExpiraEm: { not: null, lt: agora },
        matricula: { aluno: { contaId: user.contaId } },
      },
      select: { id: true, matriculaId: true },
    });

    if (expirando.length === 0) {
      return NextResponse.json(expireContratosResultDTOSchema.parse({ updated: 0 }));
    }

    const ids = expirando.map((c) => c.id);

    await prisma.contrato.updateMany({
      where: { id: { in: ids } },
      data: { status: 'EXPIRADO' },
    });

    await prisma.matricula.updateMany({
      where: { contratoAtualId: { in: ids } },
      data: { statusContrato: 'EXPIRADO', contratoAtualId: null },
    });

    return NextResponse.json(expireContratosResultDTOSchema.parse({ updated: ids.length }));
  } catch (error) {
    console.error('[CONTRATOS_EXPIRE]', error);
    return NextResponse.json(
      { error: { message: 'Erro ao expirar contratos' } },
      { status: 500 },
    );
  }
}
