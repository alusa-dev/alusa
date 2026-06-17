import { NextRequest, NextResponse } from 'next/server';

import { getEventScopedResources } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.view');
    return NextResponse.json({ data: await getEventScopedResources(ctx, eventId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_RECURSOS_EVENTO');
  }
}
