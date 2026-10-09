import { NextRequest, NextResponse } from 'next/server';

import { reactivateEventParticipantWithCharge } from '@alusa/finance';
import { reactivateEventParticipantRequestSchema } from '@alusa/lib/events/events.schema';
import { eventParticipantRouteParamsDTOSchema } from '@/features/events/dtos';
import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };


export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = eventParticipantRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('events.update');
    const body = reactivateEventParticipantRequestSchema.parse(await request.json());

    const result = await reactivateEventParticipantWithCharge(ctx, eventId, participantId, body);
    if (!result.success) {
      return NextResponse.json({ error: { code: result.error, message: result.message } }, { status: result.status });
    }
    return NextResponse.json({ data: result.data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REINSCREVER_PARTICIPANTE');
  }
}
