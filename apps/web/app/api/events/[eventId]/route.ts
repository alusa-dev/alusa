import { NextRequest, NextResponse } from 'next/server';

import { updateSchoolEventSchema } from '@alusa/lib/events/events.schema';
import { getSchoolEvent, updateSchoolEvent, deleteSchoolEvent } from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.view');
    return NextResponse.json({ data: await getSchoolEvent(ctx, eventId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_BUSCAR_EVENTO');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.update');
    const body = updateSchoolEventSchema.parse(await request.json());
    return NextResponse.json({ data: await updateSchoolEvent(ctx, eventId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_EVENTO');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.archive'); // Using archive permission as it fits destruction context, or update. Let's use events.archive or update.
    return NextResponse.json(await deleteSchoolEvent(ctx, eventId));
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_DELETAR_EVENTO');
  }
}
