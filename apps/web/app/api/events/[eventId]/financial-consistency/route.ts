import { NextRequest, NextResponse } from 'next/server';

import { inspectEventFinancialConsistency } from '@alusa/lib/events/events.service';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('eventFinance.view');
    return NextResponse.json({ data: await inspectEventFinancialConsistency(ctx, eventId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_INSPECIONAR_CONSISTENCIA_FINANCEIRA_EVENTO');
  }
}
