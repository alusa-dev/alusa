import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listEventTicketCheckIns } from '@alusa/lib/events/ticket-checkin.service';
import { eventRouteParamsDTOSchema } from '@/features/events/dtos';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };
const eventTicketCheckInsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { eventId } = eventRouteParamsDTOSchema.parse(await params);
    const query = eventTicketCheckInsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const ctx = await getEventsContext('eventTickets.view');
    const data = await listEventTicketCheckIns(ctx.contaId, eventId, query);
    return NextResponse.json({ data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_CHECK_INS');
  }
}
