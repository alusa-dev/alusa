import { NextRequest, NextResponse } from 'next/server';

import { updateSchoolEventStatusSchema } from '@alusa/lib/events/events.schema';
import { updateSchoolEventStatus } from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const body = updateSchoolEventStatusSchema.parse(await request.json());
    const permission =
      body.status === 'ARCHIVED'
        ? 'events.archive'
        : body.status === 'CANCELLED'
          ? 'events.cancel'
          : 'events.update';
    const ctx = await getEventsContext(permission);
    return NextResponse.json({ data: await updateSchoolEventStatus(ctx, eventId, body.status) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_STATUS_EVENTO');
  }
}
