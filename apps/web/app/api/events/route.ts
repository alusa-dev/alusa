import { NextRequest, NextResponse } from 'next/server';

import {
  createSchoolEvent,
  createSchoolEventSchema,
  listSchoolEvents,
  listSchoolEventsQuerySchema,
} from '@alusa/lib';

import { getEventsContext, handleEventsRouteError, queryObject } from './_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('events.view');
    const query = listSchoolEventsQuerySchema.parse(queryObject(request));
    return NextResponse.json(await listSchoolEvents(ctx, query));
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_EVENTOS');
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getEventsContext('events.create');
    const body = createSchoolEventSchema.parse(await request.json());
    return NextResponse.json({ data: await createSchoolEvent(ctx, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_EVENTO');
  }
}
