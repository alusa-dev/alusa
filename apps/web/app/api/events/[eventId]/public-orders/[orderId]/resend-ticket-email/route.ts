import { NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';
import { prisma } from '@alusa/database';
import { EventsError } from '@alusa/lib/events/events.service';
import { requestPublicOrderTicketEmailResend } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; orderId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { eventId, orderId } = await params;
    const ctx = await getEventsContext('eventTickets.markPaid');

    const order = await prisma.eventMapOrder.findFirst({
      where: { id: orderId, contaId: ctx.contaId, eventId, status: 'CONFIRMED' },
      select: { accessToken: true },
    });
    if (!order) throw new EventsError('PEDIDO_NAO_ENCONTRADO', 'Pedido confirmado não encontrado.', 404);

    const result = await requestPublicOrderTicketEmailResend(orderId, order.accessToken);
    await drainFinanceWebhookSideEffectOutbox({ contaId: ctx.contaId, limit: 5 }).catch(() => null);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REENVIAR_EMAIL_INGRESSOS_ADMIN');
  }
}
