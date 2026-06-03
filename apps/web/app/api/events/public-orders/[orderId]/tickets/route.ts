import { NextRequest, NextResponse } from 'next/server';

import { getEventMapOrderTicketsForAdmin } from '@alusa/lib/events/map/event-map.service';

import { createEventTicketsPdf } from '@/lib/events/event-ticket-pdf';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await getEventsContext('eventTickets.view');
    const { orderId } = await params;
    const order = await getEventMapOrderTicketsForAdmin(ctx.contaId, orderId);
    const pdf = createEventTicketsPdf(order);

    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="ingressos-${order.id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_INGRESSOS_ADMIN');
  }
}
