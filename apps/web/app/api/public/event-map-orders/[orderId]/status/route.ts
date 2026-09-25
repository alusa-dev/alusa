import { NextRequest, NextResponse } from 'next/server';

import { getPublicEventMapOrderStatus } from '@alusa/lib/events/map/event-map.service';
import { ipFromRequest, rateLimitSubject, strictRateLimitAsync } from '@/lib/rate-limit';

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

    const ip = ipFromRequest(request);
    const subject = await rateLimitSubject(ip);
    const [perOrder, perIp] = await Promise.all([
      strictRateLimitAsync(`public:event-map-order-status:${orderId}:${subject}`, 20, 5 * 60_000),
      strictRateLimitAsync(`public:event-map-order-status-subject:${subject}`, 120, 5 * 60_000),
    ]);
    const limited = [perOrder, perIp].find((result) => !result.ok);
    if (limited) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Muitas consultas de status. Aguarde alguns instantes.' } },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limited.resetAt - Date.now()) / 1000))) } },
      );
    }

    return NextResponse.json({ data: await getPublicEventMapOrderStatus(orderId, token) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_OBTER_STATUS_PEDIDO_PUBLICO');
  }
}
