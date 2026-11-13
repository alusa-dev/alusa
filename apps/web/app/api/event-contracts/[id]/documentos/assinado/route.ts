import { NextRequest, NextResponse } from 'next/server';
import { eventContractRouteParamsDTOSchema } from '@/features/events/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getSignedEventContractDocument } from '@/src/server/contracts/contract-read.service';
import { loadSignedContractPdf } from '@/src/server/contracts/signed-contract-pdf-storage.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: { message: 'Não autorizado' } }, { status: 401 });
  const { id } = eventContractRouteParamsDTOSchema.parse(await params);
  const documento = await getSignedEventContractDocument({ contaId: auth.contaId, contratoId: id });
  if (!documento) return NextResponse.json({ error: { message: 'PDF assinado não encontrado' } }, { status: 404 });
  const bytes = await loadSignedContractPdf({ contaId: auth.contaId, contractId: id, storageKey: documento.storageKey, arquivoUrl: documento.arquivoUrl, sha256: documento.hashSha256 });
  if (!bytes) return NextResponse.redirect(documento.arquivoUrl);
  return new NextResponse(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="contrato-evento-assinado-${id}.pdf"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-pdf-sha256': documento.hashSha256 } });
}
