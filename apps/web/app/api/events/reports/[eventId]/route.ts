import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getEventReportDetail } from '@alusa/lib';
import { EventsError } from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const paramsSchema = z.object({ eventId: z.string().trim().min(1) });

export async function GET(_request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const { contaId } = await getEventsContext('eventReports.view');
    const { eventId } = paramsSchema.parse(await context.params);
    const report = await getEventReportDetail(contaId, eventId);
    if (!report) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
    return NextResponse.json({ data: report }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_RELATORIO_EVENTO');
  }
}
