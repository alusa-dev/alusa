import { NextRequest, NextResponse } from 'next/server';

import { publicEventMapCheckoutRouteParamsDTOSchema } from '@/features/public/dtos';
import { completePublicEventMapCheckout, syncCustomerNotificationChannels } from '@alusa/finance';
import { publicCheckoutSchema } from '@alusa/lib/events/map/event-map.schema';

import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';
import { getPublicEventMapOrderCustomerContext } from '@/src/server/events/public-order.service';
import { handleEventsRouteError } from '../../../../events/_helpers';
import { enforcePublicEventMapRateLimit } from '@/src/server/events/public-event-map-rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ publicSlug: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    ensureEventAsaasPaymentProviderRegistered();
    const parsedParams = publicEventMapCheckoutRouteParamsDTOSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: { code: 'ERRO_CHECKOUT_MAPA_PUBLICO', message: 'Mapa público inválido.' } },
        { status: 400 },
      );
    }
    const { publicSlug } = parsedParams.data;
    const limited = await enforcePublicEventMapRateLimit(request, 'checkout', publicSlug);
    if (limited) return limited;
    // Malformed/empty JSON is a client validation error, not an unexpected
    // server exception (and should not produce an error stack in the logs).
    const body = publicCheckoutSchema.parse(await request.json().catch(() => null));
    const data = await completePublicEventMapCheckout(publicSlug, body);

    // O checkout público não oferece seleção de canais. Portanto, o contrato
    // do ticket é aplicar explicitamente WhatsApp + e-mail ao customer usado
    // pela cobrança, independentemente dos defaults globais da conta.
    const order = await getPublicEventMapOrderCustomerContext(data.orderId);
    if (order?.asaasCustomerId && process.env.PLAYWRIGHT_TEST !== 'true') {
      const notificationSync = await syncCustomerNotificationChannels(
        order.contaId,
        order.asaasCustomerId,
        { email: true, sms: false, whatsapp: true },
      );
      if (!notificationSync.success || notificationSync.warnings.length > 0) {
        console.warn('[event-map] Preferências de notificação do ticket aplicadas parcialmente', {
          orderId: data.orderId,
          warnings: notificationSync.warnings.map((warning) => ({
            event: warning.event,
            channel: warning.channel,
            code: warning.code,
          })),
        });
      }
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CHECKOUT_MAPA_PUBLICO');
  }
}
