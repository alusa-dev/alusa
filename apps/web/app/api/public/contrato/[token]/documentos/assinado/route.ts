import { NextRequest, NextResponse } from 'next/server';
import { contratoPublicTokenParamsDTOSchema } from '@/features/contracts/dtos';
import { getSignedContractDocument, findPublicContractByToken } from '@/src/server/contracts/contract-read.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export const dynamic = 'force-dynamic';
const notFound = () => new NextResponse(null, { status: 404, headers: { 'cache-control': 'private, no-store, max-age=0', pragma: 'no-cache', 'x-robots-tag': 'noindex, nofollow' } });
const unavailable = (request: NextRequest, error: unknown) => {
  logApiOperationalEvent({ severity: 'error', eventName: 'api.public_contract.document.unavailable', route: '/api/public/contrato/[token]/documentos/assinado', method: 'GET', requestId: getRequestId(request), error, result: 'unavailable' });
  return new NextResponse(null, { status: 503, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  let rawParams: { token: string };
  try {
    rawParams = await params;
  } catch {
    return notFound();
  }
  const parsed = contratoPublicTokenParamsDTOSchema.safeParse(rawParams);
  if (!parsed.success) return notFound();
  try {
    const contract = await findPublicContractByToken(parsed.data.token);
    if (!contract || contract.status !== 'ASSINADO') return notFound();
    const document = await getSignedContractDocument({ contaId: contract.contaId, contratoId: contract.id });
    if (!document) return notFound();
    const match = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(document.arquivoUrl);
    if (!match) throw new Error('SIGNED_PDF_INVALID_CONTENT');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.byteLength < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('SIGNED_PDF_INVALID_CONTENT');
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline; filename="contrato-assinado.pdf"',
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
