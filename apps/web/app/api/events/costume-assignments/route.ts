import { NextRequest, NextResponse } from 'next/server';

import {
  createCostumeAssignment,
  createCostumeAssignmentSchema,
  listByEventQuerySchema,
  listCostumeAssignments,
} from '@alusa/lib';

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
