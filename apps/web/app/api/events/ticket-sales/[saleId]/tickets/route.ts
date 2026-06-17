import { NextRequest, NextResponse } from 'next/server';

import { getStaffSaleTicketsForAdmin } from '@alusa/lib/events/map/staff-map-sales.service';

import { createEventTicketsPdf } from '@/lib/events/event-ticket-pdf';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ saleId: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { saleId } = await params;
    const ctx = await getEventsContext('eventTickets.view');
    const sale = await getStaffSaleTicketsForAdmin(ctx.contaId, saleId);
    const pdf = createEventTicketsPdf(sale);

    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="ingressos-${sale.id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_INGRESSOS_VENDA');
  }
}
