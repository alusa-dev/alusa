import { NextResponse } from 'next/server';

import { removeCancelledEventParticipant } from '@alusa/lib/events/events.service';

import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';
import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    ensureEventAsaasPaymentProviderRegistered();
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('events.update');
    const result = await removeCancelledEventParticipant(ctx, eventId, participantId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REMOVER_PARTICIPANTE');
  }
}
