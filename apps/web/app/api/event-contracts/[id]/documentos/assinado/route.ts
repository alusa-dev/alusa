import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/prisma/client';
import { getSessionUser } from '@/lib/auth/session';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user?.contaId) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  const { id } = await params;
  const documento = await prisma.eventoContratoDocumento.findFirst({
    where: { contaId: user.contaId, eventoContratoId: id, tipo: 'ASSINADO', eventoContrato: { contaId: user.contaId } },
    orderBy: { createdAt: 'desc' },
  });
  if (!documento) return NextResponse.json({ error: { message: 'PDF assinado não encontrado' } }, { status: 404 });
  if (!documento.arquivoUrl.startsWith('data:application/pdf;base64,')) return NextResponse.redirect(documento.arquivoUrl);
  const bytes = Buffer.from(documento.arquivoUrl.replace('data:application/pdf;base64,', ''), 'base64');
  return new NextResponse(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="contrato-evento-assinado-${id}.pdf"`, 'cache-control': 'private, no-store', 'x-pdf-sha256': documento.hashSha256 } });
}
