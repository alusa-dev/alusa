import { NextRequest, NextResponse } from 'next/server';

import { registerEventParticipantRequestSchema } from '@alusa/lib/events/events.schema';
import { listEventParticipants } from '@alusa/lib/events/events.service';
import {
  isUniqueConstraintError,
  registerEventParticipantForHttp,
  replayEventParticipantRegistration,
} from '@/src/server/events/register-event-participant.service';
import { getRequestId, logApiResponse } from '@/lib/observability/api-logger';
import { eventRouteParamsDTOSchema } from '@/features/events/dtos';
import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = eventRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('events.view');
    const participants = await listEventParticipants(ctx, eventId);
    return NextResponse.json({
      data: participants.map((participant) => ({
        ...participant,
        canPermanentlyDelete: ctx.role === 'ADMIN',
      })),
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_PARTICIPANTES');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const route = '/api/events/[eventId]/participants';
  const requestId = getRequestId(request);
  const startedAt = Date.now();
  let eventIdForLog: string | undefined;
  let tenantId: string | undefined;
  let uiRequestId: string | undefined;
  const complete = (response: Response, errorCode?: string, fields?: Record<string, unknown>) => {
    logApiResponse({
      route,
      requestId,
      method: 'POST',
      startedAt,
      status: response.status,
      errorCode,
      tenantId,
      resourceId: eventIdForLog,
      ...fields,
    });
    return response;
  };

  try {
    const { eventId } = eventRouteParamsDTOSchema.parse(await params);
    eventIdForLog = eventId;
    const ctx = await getEventsContext('events.update');
    tenantId = ctx.contaId;
    const body = registerEventParticipantRequestSchema.parse(await request.json());
    uiRequestId = body.uiRequestId;

    const result = await registerEventParticipantForHttp({ ctx, eventId, body });
    return complete(
      NextResponse.json(result.body, { status: result.status }),
      result.errorCode,
      result.fields,
    );
  } catch (error) {
    if (isUniqueConstraintError(error) && tenantId && eventIdForLog && uiRequestId) {
      const replay = await replayEventParticipantRegistration({
        contaId: tenantId,
        eventId: eventIdForLog,
        uiRequestId,
      });
      if (replay) {
        return complete(
          NextResponse.json(replay.body, { status: replay.status }),
          replay.errorCode,
          replay.fields,
        );
      }
    }

    return handleEventsRouteError(error, 'ERRO_REGISTRAR_PARTICIPANTE', {
      route,
      requestId,
      method: 'POST',
      startedAt,
      tenantId,
    });
  }
}
