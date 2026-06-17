import { NextRequest, NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';
import { syncPublicEventMapOrderPaymentByBuyer } from '@alusa/lib/events/map/event-map.service';

import { handleEventsRouteError } from '../../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { orderId } = await params;
    const token = request.nextUrl.searchParams.get('token')?.trim();
    if (!token) {
      return NextResponse.json({ error: { code: 'TOKEN_AUSENTE', message: 'Token ausente.' } }, { status: 401 });
    }

    const result = await syncPublicEventMapOrderPaymentByBuyer(orderId, token);
    await drainFinanceWebhookSideEffectOutbox({ limit: 5 }).catch(() => null);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_SINCRONIZAR_PAGAMENTO_PEDIDO_PUBLICO');
  }
}
