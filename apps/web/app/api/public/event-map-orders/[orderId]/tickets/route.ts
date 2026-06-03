import { NextRequest, NextResponse } from 'next/server';

import { getPublicEventMapOrderTickets } from '@alusa/lib/events/map/event-map.service';

import { createEventTicketsPdf } from '@/lib/events/event-ticket-pdf';

import { handleEventsRouteError } from '../../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { orderId } = await params;
    const token = request.nextUrl.searchParams.get('token')?.trim();
    if (!token) return NextResponse.json({ error: { code: 'TOKEN_AUSENTE', message: 'Token ausente.' } }, { status: 401 });

    const order = await getPublicEventMapOrderTickets(orderId, token);
    const pdf = createEventTicketsPdf(order);
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="ingressos-${order.id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_INGRESSOS_PDF');
  }
}
