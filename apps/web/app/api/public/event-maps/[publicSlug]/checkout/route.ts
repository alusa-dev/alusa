import { after, NextRequest, NextResponse } from 'next/server';

import { publicEventMapCheckoutRouteParamsDTOSchema } from '@/features/public/dtos';
import { completePublicEventMapCheckout, syncCustomerNotificationChannels } from '@alusa/finance';
import { publicCheckoutSchema } from '@alusa/lib/events/map/event-map.schema';

import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';
import { getPublicEventMapOrderCustomerContext } from '@/src/server/events/public-order.service';
import { dispatchPublicOrderTicketWhatsAppNotification } from '@/src/server/events/event-ticket-whatsapp-outbox.service';
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

    const requestId = getRequestId(request);
    after(async () => {
      if (data.status === 'CONFIRMED' && data.ticketFulfillmentStatus === 'ISSUED') {
        const startedAt = Date.now();
        try {
          const status = await dispatchPublicOrderTicketWhatsAppNotification({ orderId: data.orderId, accessToken: data.accessToken });
          logApiOperationalEvent({
            severity: status === 'FAILED' || status === 'DLQ' ? 'warn' : 'info',
            eventName: 'api.events.ticket_sale.whatsapp_outbox.dispatched',
            route: '/api/public/event-maps/[publicSlug]/checkout',
            method: 'POST', requestId, itemCount: status ? 1 : 0,
            durationMs: Date.now() - startedAt, result: status ?? 'NO_PENDING_NOTIFICATION',
          });
        } catch (error) {
          logApiOperationalEvent({
            severity: 'warn', eventName: 'api.events.ticket_sale.whatsapp_outbox_dispatch.failed',
            route: '/api/public/event-maps/[publicSlug]/checkout', method: 'POST', requestId,
            durationMs: Date.now() - startedAt, error,
          });
        }
      }

      if (process.env.PLAYWRIGHT_TEST === 'true') return;
      const startedAt = Date.now();
      try {
        // Channel synchronization is best-effort and runs after the checkout response.
        const order = await getPublicEventMapOrderCustomerContext(publicSlug, data.orderId);
        if (!order?.asaasCustomerId) return;
        const notificationSync = await syncCustomerNotificationChannels(
          order.contaId, order.asaasCustomerId,
          { email: true, sms: false, whatsapp: body.whatsappConsent },
        );
        logApiOperationalEvent({
          severity: !notificationSync.success || notificationSync.warnings.length > 0 ? 'warn' : 'info',
          eventName: !notificationSync.success || notificationSync.warnings.length > 0
            ? 'api.public_event_map.notification_sync.degraded'
            : 'api.public_event_map.notification_sync.completed',
          route: '/api/public/event-maps/[publicSlug]/checkout', method: 'POST', requestId,
          itemCount: notificationSync.warnings.length,
          durationMs: Date.now() - startedAt,
          result: notificationSync.success ? 'SUCCESS' : 'FAILED',
        });
      } catch (error) {
        logApiOperationalEvent({
          severity: 'warn', eventName: 'api.public_event_map.notification_sync.failed',
          route: '/api/public/event-maps/[publicSlug]/checkout', method: 'POST', requestId,
          durationMs: Date.now() - startedAt, error,
        });
      }
    });

    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_CHECKOUT_MAPA_PUBLICO'));
  }
}
