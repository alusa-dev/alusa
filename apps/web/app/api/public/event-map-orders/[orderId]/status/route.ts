import { NextRequest, NextResponse } from 'next/server';

import { getPublicEventMapOrderStatus } from '@alusa/lib/events/map/event-map.service';

import { handleEventsRouteError } from '../../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { orderId } = await params;
    const token = request.nextUrl.searchParams.get('token')?.trim();
    if (!token) return NextResponse.json({ error: { code: 'TOKEN_AUSENTE', message: 'Token ausente.' } }, { status: 401 });

    return NextResponse.json({ data: await getPublicEventMapOrderStatus(orderId, token) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_OBTER_STATUS_PEDIDO_PUBLICO');
  }
}
