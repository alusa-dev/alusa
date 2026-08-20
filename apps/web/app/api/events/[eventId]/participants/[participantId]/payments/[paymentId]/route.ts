import { NextRequest, NextResponse } from 'next/server';

import { deleteManualEventParticipantPayment } from '@alusa/lib/events/events.service';
import { getEventsContext, handleEventsRouteError } from '../../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string; paymentId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId, paymentId } = await params;
    const ctx = await getEventsContext('eventFinance.cancelEntry');
    const result = await deleteManualEventParticipantPayment(ctx, eventId, participantId, paymentId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_EXCLUIR_PAGAMENTO_MANUAL');
  }
}
