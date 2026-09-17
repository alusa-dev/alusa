import { NextRequest, NextResponse } from 'next/server';

import {
  eventPaymentBookQueryDTOSchema,
  eventParticipantRouteParamsDTOSchema,
} from '@/features/events/dtos';
import {
  generateEventPaymentBook,
  getEventPaymentBookLink,
} from '@/src/server/events/event-payment-book.service';
import { getEventsContext, handleEventsRouteError, jsonError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = eventParticipantRouteParamsDTOSchema.parse(await params);
    const ctx = await getEventsContext('events.view');
    const result = await getEventPaymentBookLink({ ctx, eventId, participantId });
    if (result.kind === 'error') {
      const message = result.message === 'PARTICIPANTE_NAO_ENCONTRADO'
        ? 'Inscrição não encontrada.'
        : 'Nenhum parcelamento encontrado para esta inscrição.';
      return jsonError(result.status, result.message, message);
    }
    if (result.kind !== 'redirect') {
      return jsonError(500, 'ERRO_GERAR_CARNE_PARCELAMENTO', 'Não foi possível preparar o carnê.');
    }
    return NextResponse.json({ data: { pdfUrl: result.url } });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_CARNE_PARCELAMENTO');
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = eventParticipantRouteParamsDTOSchema.parse(await params);
    const { planId } = eventPaymentBookQueryDTOSchema.parse({
      planId: new URL(request.url).searchParams.get('planId') ?? undefined,
    });
    const ctx = await getEventsContext('events.view');
    const result = await generateEventPaymentBook({ ctx, eventId, participantId, planId });

    if (result.kind === 'error') {
      return new NextResponse(result.message, { status: result.status });
    }
    if (result.kind === 'redirect') {
      const response = NextResponse.redirect(result.url, 302);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return new NextResponse(result.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${result.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[payment-book][get] Error generating PDF', {
      error: error instanceof Error ? error.message : 'payment_book_generation_failed',
    });
    return new NextResponse('Erro interno ao gerar o PDF.', { status: 500 });
  }
}
