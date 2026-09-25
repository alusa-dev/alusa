import { NextRequest, NextResponse } from 'next/server';

import { syncPublicEventMapOrderPaymentByBuyer } from '@alusa/finance';
import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';
import { enforcePublicEventMapPaymentSyncRateLimit } from '@/src/server/events/public-event-map-rate-limit';

import { handleEventsRouteError } from '../../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    ensureEventAsaasPaymentProviderRegistered();
    const { orderId } = await params;
    const limited = await enforcePublicEventMapPaymentSyncRateLimit(request, orderId);
    if (limited) return limited;
    const token = request.nextUrl.searchParams.get('token')?.trim();
    if (!token) {
      return NextResponse.json({ error: { code: 'TOKEN_AUSENTE', message: 'Token ausente.' } }, { status: 401 });
    }

    const result = await syncPublicEventMapOrderPaymentByBuyer(orderId, token);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_SINCRONIZAR_PAGAMENTO_PEDIDO_PUBLICO');
  }
}
