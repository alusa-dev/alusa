import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  deleteManualEventParticipantFee,
  refundManualEventParticipantFee,
} from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

const postBodySchema = z.object({
  action: z.enum(['refund']),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { participantId } = await params;
    const body = postBodySchema.parse(await request.json());
    const ctx = await getEventsContext('eventFinance.cancelEntry');

    if (body.action === 'refund') {
      return NextResponse.json({ data: await refundManualEventParticipantFee(ctx, participantId) });
    }

    return NextResponse.json(
      { error: { code: 'ACAO_INVALIDA', message: 'Ação inválida.' } },
      { status: 400 },
    );
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ESTORNAR_TAXA_INSCRICAO');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { participantId } = await params;
    const ctx = await getEventsContext('eventFinance.cancelEntry');
    return NextResponse.json({ data: await deleteManualEventParticipantFee(ctx, participantId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_EXCLUIR_TAXA_INSCRICAO');
  }
}
