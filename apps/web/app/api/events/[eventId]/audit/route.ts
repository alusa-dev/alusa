import { NextRequest, NextResponse } from 'next/server';

import { listEventAudit } from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('eventAudit.view');
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50);
    return NextResponse.json({ data: await listEventAudit(ctx, eventId, limit) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_HISTORICO_EVENTO');
  }
}
