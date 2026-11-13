import { NextRequest, NextResponse } from 'next/server';
import { publicEventContractRouteParamsDTOSchema } from '@/features/public/dtos';
import { findPublicEventContractByToken } from '@alusa/lib/events/event-contracts.service';
import { getSignedEventContractDocument } from '@/src/server/contracts/contract-read.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { loadSignedContractPdf } from '@/src/server/contracts/signed-contract-pdf-storage.service';

export const dynamic = 'force-dynamic';
const notFound = () => new NextResponse(null, { status: 404, headers: { 'cache-control': 'private, no-store, max-age=0', pragma: 'no-cache', 'x-robots-tag': 'noindex, nofollow' } });
const unavailable = (request: NextRequest, error: unknown) => {
  logApiOperationalEvent({ severity: 'error', eventName: 'api.public_event_contract.document.unavailable', route: '/api/public/event-contrato/[token]/documentos/assinado', method: 'GET', requestId: getRequestId(request), error, result: 'unavailable' });
  return new NextResponse(null, { status: 503, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  let rawParams: { token: string };
  try {
    rawParams = await params;
  } catch {
    return notFound();
  }
  const parsed = publicEventContractRouteParamsDTOSchema.safeParse(rawParams);
  if (!parsed.success) return notFound();
  try {
    const contract = await findPublicEventContractByToken(parsed.data.token);
    if (!contract || contract.status !== 'ASSINADO') return notFound();
    const document = await getSignedEventContractDocument({ contaId: contract.contaId, contratoId: contract.id });
    if (!document) return notFound();
    const bytes = await loadSignedContractPdf({ contaId: contract.contaId, contractId: contract.id, storageKey: document.storageKey, arquivoUrl: document.arquivoUrl, sha256: document.hashSha256 });
    if (!bytes) return notFound();
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline; filename="contrato-evento-assinado.pdf"',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, no-store, max-age=0',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
      'x-pdf-sha256': document.hashSha256,
    } });
  } catch (error) {
    return unavailable(request, error);
  }
}
