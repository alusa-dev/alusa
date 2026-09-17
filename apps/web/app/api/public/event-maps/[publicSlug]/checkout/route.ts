import { NextRequest, NextResponse } from 'next/server';

import { publicEventMapCheckoutRouteParamsDTOSchema } from '@/features/public/dtos';
import {
  drainFinanceWebhookSideEffectOutbox,
  syncCustomerNotificationChannels,
} from '@alusa/finance';
import { publicCheckoutSchema } from '@alusa/lib/events/map/event-map.schema';
import { completePublicEventMapCheckout } from '@alusa/lib/events/map/event-map.service';

import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';
import { getPublicEventMapOrderCustomerContext } from '@/src/server/events/public-order.service';
import { handleEventsRouteError } from '../../../../events/_helpers';

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
    const body = publicCheckoutSchema.parse(await request.json());
    const data = await completePublicEventMapCheckout(publicSlug, body);

    // O checkout público não oferece seleção de canais. Portanto, o contrato
    // do ticket é aplicar explicitamente WhatsApp + e-mail ao customer usado
    // pela cobrança, independentemente dos defaults globais da conta.
    const order = await getPublicEventMapOrderCustomerContext(data.orderId);
    if (order?.asaasCustomerId) {
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

    await drainFinanceWebhookSideEffectOutbox({ limit: 8 }).catch(() => null);
    return NextResponse.json({ data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CHECKOUT_MAPA_PUBLICO');
  }
}
