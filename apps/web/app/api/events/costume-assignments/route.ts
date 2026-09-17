import { NextRequest, NextResponse } from 'next/server';

import { createCostumeAssignmentSchema, listByEventQuerySchema } from '@alusa/lib/events/events.schema';
import { createCostumeAssignment, listCostumeAssignments } from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError, queryObject } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventCostumes.view');
    const query = listByEventQuerySchema.parse(queryObject(request));
    return NextResponse.json({ data: await listCostumeAssignments(ctx, { eventId: query.eventId }) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_ENTREGAS_FIGURINO');
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventCostumes.manage');
    const body = createCostumeAssignmentSchema.parse(await request.json());
    return NextResponse.json({ data: await createCostumeAssignment(ctx, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_ENTREGA_FIGURINO');
  }
}
