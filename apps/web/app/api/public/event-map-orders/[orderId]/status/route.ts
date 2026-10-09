import { NextRequest, NextResponse } from 'next/server';

import {
  assertPublicEventMapOrderCapability,
  getPublicEventMapOrderStatus,
} from '@alusa/lib/events/map/event-map.service';
import {
  enforcePublicEventMapOrderStatusRateLimit,
  enforcePublicEventMapOrderStatusSubjectRateLimit,
} from '@/src/server/events/public-event-map-rate-limit';

import { handleEventsRouteError } from '../../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { orderId } = await params;
    const token = request.nextUrl.searchParams.get('token')?.trim();
    if (!token) return noStore(NextResponse.json({ error: { code: 'TOKEN_AUSENTE', message: 'Token ausente.' } }, { status: 401 }));

    const subjectLimited = await enforcePublicEventMapOrderStatusSubjectRateLimit(request);
    if (subjectLimited) return noStore(subjectLimited);

    // Verify capability with a minimal query before creating the per-order
    // bucket. Rejected requests and requests above the limit avoid relation
    // loading and detailed status assembly.
    await assertPublicEventMapOrderCapability(orderId, token);
    const orderLimited = await enforcePublicEventMapOrderStatusRateLimit(request, orderId);
    if (orderLimited) return noStore(orderLimited);

    const data = await getPublicEventMapOrderStatus(orderId, token);
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_OBTER_STATUS_PEDIDO_PUBLICO'));
  }
}
