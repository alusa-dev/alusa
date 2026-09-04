import { NextRequest, NextResponse } from 'next/server';

import { getPublicStaffSaleTickets } from '@alusa/lib/events/map/staff-map-sales.service';

import { createEventTicketsPdf } from '@/lib/events/event-ticket-pdf';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ saleId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { saleId } = await params;
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return new NextResponse('Não encontrado.', { status: 404 });

  try {
    const sale = await getPublicStaffSaleTickets(saleId, token);
    const pdf = createEventTicketsPdf(sale);
    const body = new Uint8Array(pdf).buffer;

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="ingressos-${sale.id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return new NextResponse('Não encontrado.', { status: 404 });
  }
}
