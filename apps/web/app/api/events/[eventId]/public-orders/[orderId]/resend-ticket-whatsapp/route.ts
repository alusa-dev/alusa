import { NextResponse } from 'next/server';
import { after } from 'next/server';

import { requestPublicOrderTicketWhatsAppResend } from '@alusa/lib/events/map/event-map.service';
import { eventPublicOrderNestedRouteParamsDTOSchema } from '@/features/events/dtos';
import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';
import { dispatchEventTicketWhatsAppNotification } from '@/src/server/events/event-ticket-whatsapp-outbox.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; orderId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { eventId, orderId } = eventPublicOrderNestedRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('eventTickets.markPaid');
    const data = await requestPublicOrderTicketWhatsAppResend(ctx, eventId, orderId);
    if (data.queued && data.notificationId) {
      const notificationId = data.notificationId;
      after(async () => {
        try {
          await dispatchEventTicketWhatsAppNotification({ contaId: ctx.contaId, notificationId });
        } catch {
          // Durable notification/outbox and cron retry remain authoritative.
        }
      });
    }
    return NextResponse.json({ data }, { status: data.queued ? 202 : 200 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REENVIAR_WHATSAPP_INGRESSOS');
  }
}
