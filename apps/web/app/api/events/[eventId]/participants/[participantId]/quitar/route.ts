import { NextRequest, NextResponse } from 'next/server';

import { quitarParticipantFeeSchema } from '@alusa/lib/events/events.schema';
import { quitarEventParticipantFee } from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('eventFinance.markReceived');
    const body = quitarParticipantFeeSchema.parse(await request.json());
    const result = await quitarEventParticipantFee(ctx, eventId, participantId, body);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_QUITAR_TAXA_PARTICIPANTE');
  }
}
