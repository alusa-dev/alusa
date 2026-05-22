import { NextRequest, NextResponse } from 'next/server';

import {
  createCostume,
  createCostumeSchema,
  listByEventQuerySchema,
  listCostumes,
} from '@alusa/lib';

import { getEventsContext, handleEventsRouteError, queryObject } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventCostumes.view');
    const query = listByEventQuerySchema.parse(queryObject(request));
    return NextResponse.json({ data: await listCostumes(ctx, { eventId: query.eventId }) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_FIGURINOS_EVENTO');
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventCostumes.manage');
    const body = createCostumeSchema.parse(await request.json());
    return NextResponse.json({ data: await createCostume(ctx, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_FIGURINO_EVENTO');
  }
}
