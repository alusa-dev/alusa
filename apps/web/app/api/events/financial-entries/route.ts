import { NextRequest, NextResponse } from 'next/server';

import {
  createEventFinancialEntrySchema,
  createFinancialEntry,
  listFinancialEntries,
  listFinancialEntriesQuerySchema,
} from '@alusa/lib';

import { getEventsContext, handleEventsRouteError, queryObject } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventFinance.view');
    const query = listFinancialEntriesQuerySchema.parse(queryObject(request));
    return NextResponse.json({ data: await listFinancialEntries(ctx, { eventId: query.eventId, type: query.type }) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_LANCAMENTOS_EVENTO');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createEventFinancialEntrySchema.parse(await request.json());
    const ctx = await getEventsContext(
      body.type === 'COST' ? 'eventFinance.createCost' : 'eventFinance.createRevenue',
    );
    return NextResponse.json({ data: await createFinancialEntry(ctx, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_LANCAMENTO_EVENTO');
  }
}
