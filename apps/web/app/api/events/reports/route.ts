import { NextRequest, NextResponse } from 'next/server';

import { eventReportQuerySchema } from '@alusa/lib/events/events.schema';
import { getEventReports } from '@alusa/lib/events/events.service';

import { runWithTenant } from '@/lib/prisma-tenant';

import { getEventsContext, handleEventsRouteError, queryObject } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventReports.view');
    const query = eventReportQuerySchema.parse(queryObject(request));
    const report = await runWithTenant(
      ctx.contaId,
      (tx) => getEventReports(ctx, query, tx),
      { isolationLevel: 'RepeatableRead' },
    );
    return NextResponse.json(report, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const response = handleEventsRouteError(error, 'ERRO_GERAR_RELATORIO_EVENTOS');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
