import { NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';
import { EventsError } from '@alusa/lib/events/events.service';
import { requestPublicOrderTicketEmailResend } from '@alusa/lib/events/map/event-map.service';

import { eventPublicOrderNestedRouteParamsDTOSchema } from '@/features/events/dtos';
import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';
import { getConfirmedEventOrderAccess } from '@/src/server/events/event-route-read.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; orderId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { eventId, orderId } = eventPublicOrderNestedRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('eventTickets.markPaid');

    const order = await getConfirmedEventOrderAccess({ eventId, orderId, contaId: ctx.contaId });
    if (!order) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido confirmado não encontrado.', 404);

    const result = await requestPublicOrderTicketEmailResend(orderId, order.accessToken);
    await drainFinanceWebhookSideEffectOutbox({ contaId: ctx.contaId, limit: 5 }).catch(() => null);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REENVIAR_EMAIL_INGRESSOS_ADMIN');
  }
}
