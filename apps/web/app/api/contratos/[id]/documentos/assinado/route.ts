import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';
import { contratoRouteParamsDTOSchema } from '@/features/contratos/dtos';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user?.contaId) {
    return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  }

  const rawParams = await params;
  const { id } = contratoRouteParamsDTOSchema.parse(rawParams);

  const documento = await prisma.contratoDocumento.findFirst({
    where: {
      contaId: user.contaId,
      contratoId: id,
      tipo: 'ASSINADO',
      contrato: { contaId: user.contaId },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!documento) {
    return NextResponse.json(
      { error: { message: 'PDF assinado não encontrado' } },
      { status: 404 },
    );
  }

  if (!documento.arquivoUrl.startsWith('data:application/pdf;base64,')) {
    return NextResponse.redirect(documento.arquivoUrl);
  }

  const base64 = documento.arquivoUrl.replace('data:application/pdf;base64,', '');
  const bytes = Buffer.from(base64, 'base64');

  return new NextResponse(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="contrato-assinado-${id}.pdf"`,
      'cache-control': 'private, no-store',
      'x-pdf-sha256': documento.hashSha256,
    },
  });
}
