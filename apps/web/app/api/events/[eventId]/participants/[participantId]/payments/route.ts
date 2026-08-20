import { NextRequest, NextResponse } from 'next/server';

import { manualEventParticipantPaymentSchema } from '@alusa/lib/events/events.schema';
import { createManualEventParticipantPayment } from '@alusa/lib/events/events.service';
import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('eventFinance.markReceived');
    const body = manualEventParticipantPaymentSchema.parse(await request.json());
    const result = await createManualEventParticipantPayment(ctx, eventId, participantId, body);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_DAR_BAIXA_MANUAL');
  }
}
