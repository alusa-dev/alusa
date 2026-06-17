import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { markEventMapTicketUsed, verifyEventMapTicketForCheckIn } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.object({
  ticketCode: z.string().min(4).max(64),
  confirm: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ eventId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('eventTickets.view');
    const body = bodySchema.parse(await request.json());

    if (body.confirm) {
      const result = await markEventMapTicketUsed(ctx.contaId, eventId, body.ticketCode, ctx.userId);
      return NextResponse.json({ data: result });
    }

    const ticket = await verifyEventMapTicketForCheckIn(ctx.contaId, eventId, body.ticketCode);
    return NextResponse.json({ data: { ticket } });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_VERIFICAR_INGRESSO');
  }
}
