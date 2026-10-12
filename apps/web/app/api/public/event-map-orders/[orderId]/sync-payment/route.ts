import { after, NextRequest, NextResponse } from 'next/server';

import { syncPublicEventMapOrderPaymentByBuyer } from '@alusa/finance';
import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';
import { enforcePublicEventMapPaymentSyncRateLimit } from '@/src/server/events/public-event-map-rate-limit';

import { handleEventsRouteError } from '../../../../events/_helpers';
import { dispatchPublicOrderTicketWhatsAppNotification } from '@/src/server/events/event-ticket-whatsapp-outbox.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    ensureEventAsaasPaymentProviderRegistered();
    const { orderId } = await params;
    const limited = await enforcePublicEventMapPaymentSyncRateLimit(request);
    if (limited) return limited;
    const token = request.nextUrl.searchParams.get('token')?.trim();
    if (!token) {
      return NextResponse.json({ error: { code: 'TOKEN_AUSENTE', message: 'Token ausente.' } }, { status: 401 });
    }

    const automatic = request.nextUrl.searchParams.get('automatic') === '1';
    const result = await syncPublicEventMapOrderPaymentByBuyer(orderId, token, { automatic });
    if (result.order.status === 'CONFIRMED') {
      after(async () => {
        try {
          await dispatchPublicOrderTicketWhatsAppNotification({ orderId, accessToken: token });
        } catch {
          // The persisted notification and the WhatsApp cron retain retry ownership.
        }
      });
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_SINCRONIZAR_PAGAMENTO_PEDIDO_PUBLICO');
  }
}
