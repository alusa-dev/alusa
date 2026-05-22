import { NextRequest, NextResponse } from 'next/server';

import { eventReportQuerySchema, getEventReports } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError, queryObject } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventReports.view');
    const query = eventReportQuerySchema.parse(queryObject(request));
    return NextResponse.json(await getEventReports(ctx, query));
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_RELATORIO_EVENTOS');
  }
}
