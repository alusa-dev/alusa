import { NextRequest, NextResponse } from 'next/server';

import { eventParticipantPatchInputDTOSchema, eventParticipantRouteParamsDTOSchema } from '@/features/events/dtos';
import { getEventParticipantDetail } from '@/src/server/events/event-participant-detail-read.service';
import {
  deleteEventParticipant,
  updateEventParticipant,
} from '@/src/server/events/event-participant-mutation.service';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

function participantNotFound() {
  return NextResponse.json(
    { error: { code: 'PARTICIPANTE_NAO_ENCONTRADO', message: 'Inscrição não encontrada.' } },
    { status: 404 },
  );
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = eventParticipantRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('events.view');
    const result = await getEventParticipantDetail({ ctx, eventId, participantId });
    return result.found
      ? NextResponse.json({ data: result.data })
      : participantNotFound();
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_BUSCAR_DETALHES_PARTICIPANTE');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = eventParticipantRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('events.update');
    const body = eventParticipantPatchInputDTOSchema.parse(await request.json());
    const result = await updateEventParticipant({ ctx, eventId, participantId, body });
    return result.found ? NextResponse.json({ data: result.data }) : participantNotFound();
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_PARTICIPANTE');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = eventParticipantRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('events.update');
    const result = await deleteEventParticipant({ ctx, eventId, participantId });
    return result.found
      ? NextResponse.json({ data: { ok: result.ok, grouped: result.grouped } })
      : participantNotFound();
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_DESINSCREVER_PARTICIPANTE');
  }
}
