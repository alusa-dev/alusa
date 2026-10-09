import { NextRequest, NextResponse } from 'next/server';

import { publicEventMapCheckoutRouteParamsDTOSchema } from '@/features/public/dtos';
import { completePublicEventMapCheckout, syncCustomerNotificationChannels } from '@alusa/finance';
import { publicCheckoutSchema } from '@alusa/lib/events/map/event-map.schema';

import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';
import { getPublicEventMapOrderCustomerContext } from '@/src/server/events/public-order.service';
import { handleEventsRouteError } from '../../../../events/_helpers';
import { enforcePublicEventMapRateLimit } from '@/src/server/events/public-event-map-rate-limit';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

type RouteContext = {
  params: Promise<{ publicSlug: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    ensureEventAsaasPaymentProviderRegistered();
    const parsedParams = publicEventMapCheckoutRouteParamsDTOSchema.safeParse(await params);
    if (!parsedParams.success) {
      return noStore(NextResponse.json(
        { error: { code: 'ERRO_CHECKOUT_MAPA_PUBLICO', message: 'Mapa público inválido.' } },
        { status: 400 },
      ));
    }
    const { publicSlug } = parsedParams.data;
    const limited = await enforcePublicEventMapRateLimit(request, 'checkout');
    if (limited) return noStore(limited);
    // Malformed/empty JSON is a client validation error, not an unexpected
    // server exception (and should not produce an error stack in the logs).
    const body = publicCheckoutSchema.parse(await request.json().catch(() => null));
    const data = await completePublicEventMapCheckout(publicSlug, body);

    // O checkout público não oferece seleção de canais. Portanto, o contrato
    // do ticket é aplicar explicitamente WhatsApp + e-mail ao customer usado
    // pela cobrança, independentemente dos defaults globais da conta.
    const order = await getPublicEventMapOrderCustomerContext(publicSlug, data.orderId);
    if (order?.asaasCustomerId && process.env.PLAYWRIGHT_TEST !== 'true') {
      const notificationSync = await syncCustomerNotificationChannels(
        order.contaId,
        order.asaasCustomerId,
        { email: true, sms: false, whatsapp: true },
      );
      if (!notificationSync.success || notificationSync.warnings.length > 0) {
        logApiOperationalEvent({
          severity: 'warn',
          eventName: 'api.public_event_map.notification_sync.degraded',
          route: '/api/public/event-maps/[publicSlug]/checkout',
          method: 'POST',
          requestId: getRequestId(request),
          itemCount: notificationSync.warnings.length,
        });
      }
    }

    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_CHECKOUT_MAPA_PUBLICO'));
  }
}
