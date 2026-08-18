import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { permanentlyDeleteEventParticipant } from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const permanentDeleteSchema = z.object({
  confirmation: z.string().trim().min(1),
  motivo: z.string().trim().min(1).max(1000),
});

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('events.deleteParticipant');
    const body = permanentDeleteSchema.parse(await request.json());
    const result = await permanentlyDeleteEventParticipant(ctx, eventId, participantId, body);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_EXCLUIR_PARTICIPANTE_DEFINITIVAMENTE');
  }
}
