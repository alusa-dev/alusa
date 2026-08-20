import { NextRequest, NextResponse } from 'next/server';

import { refundManualEventParticipantPayment } from '@alusa/lib/events/events.service';
import { getEventsContext, handleEventsRouteError } from '../../../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string; paymentId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId, paymentId } = await params;
    const ctx = await getEventsContext('eventFinance.cancelEntry');
    const result = await refundManualEventParticipantPayment(ctx, eventId, participantId, paymentId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ESTORNAR_PAGAMENTO_MANUAL');
  }
}
