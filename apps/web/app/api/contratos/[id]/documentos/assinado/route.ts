import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { contratoRouteParamsDTOSchema } from '@/features/contracts/dtos';
import { getSignedContractDocument } from '@/src/server/contracts/contract-read.service';
import { loadSignedContractPdf } from '@/src/server/contracts/signed-contract-pdf-storage.service';

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

  const documento = await getSignedContractDocument({ contaId: user.contaId, contratoId: id });

  if (!documento) {
    return NextResponse.json(
      { error: { message: 'PDF assinado não encontrado' } },
      { status: 404 },
    );
  }

  const bytes = await loadSignedContractPdf({ contaId: user.contaId, contractId: id, storageKey: documento.storageKey, arquivoUrl: documento.arquivoUrl, sha256: documento.hashSha256 });
  if (!bytes) return NextResponse.redirect(documento.arquivoUrl);

  return new NextResponse(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="contrato-assinado-${id}.pdf"`,
      'cache-control': 'private, no-store',
      'x-pdf-sha256': documento.hashSha256,
    },
  });
}
