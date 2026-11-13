import { NextRequest, NextResponse } from 'next/server';
import { findPublicEventContractByToken } from '@alusa/lib/events/event-contracts.service';
import { publicEventContractRouteParamsDTOSchema } from '@/features/public/dtos';
import { getStorageObject, isR2Configured, storageKeyFromUrl } from '@/lib/r2-storage';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export const dynamic = 'force-dynamic';
const unavailable = (request: NextRequest, error: unknown) => {
  logApiOperationalEvent({
    severity: 'error',
    eventName: 'api.public_event_contract.document.unavailable',
    route: '/api/public/event-contrato/[token]/document',
    method: 'GET',
    requestId: getRequestId(request),
    error,
    result: 'unavailable',
  });
  return new NextResponse(null, {
    status: 503,
    headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
  });
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  let rawParams: { token: string };
  try {
    rawParams = await params;
  } catch {
    return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const parsed = publicEventContractRouteParamsDTOSchema.safeParse(rawParams);
  if (!parsed.success)
    return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  try {
    if (!isR2Configured()) return unavailable(request, new Error('R2_NOT_CONFIGURED'));
  } catch (error) {
    return unavailable(request, error);
  }
  let contract;
  try {
    contract = await findPublicEventContractByToken(parsed.data.token);
  } catch (error) {
    return unavailable(request, error);
  }
  if (!contract || contract.status === 'CANCELADO')
    return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  const key = storageKeyFromUrl(contract.arquivoPdfUrl);
  if (!key)
    return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  try {
    const object = await getStorageObject(key);
    if (!object.Body)
      return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
    const bytes = await object.Body.transformToByteArray();
    if (!bytes.byteLength)
      return new NextResponse(null, { status: 404, headers: { 'cache-control': 'no-store' } });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'inline; filename="contrato.pdf"',
        'content-length': String(bytes.byteLength),
        'cache-control': 'private, no-store, max-age=0',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchKey') {
      return new NextResponse(null, {
        status: 404,
        headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
      });
    }
    return unavailable(request, error);
  }
}
