import { NextRequest, NextResponse } from 'next/server';

import { updateEventFinancialEntrySchema, updateFinancialEntry } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: { entryId: string } };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const body = updateEventFinancialEntrySchema.parse(await request.json());
    const permission =
      body.status === 'PAID'
        ? 'eventFinance.markPaid'
        : body.status === 'RECEIVED'
          ? 'eventFinance.markReceived'
          : body.status === 'CANCELLED' || body.status === 'REFUNDED'
            ? 'eventFinance.cancelEntry'
            : 'eventFinance.createCost';
    const ctx = await getEventsContext(permission);
    return NextResponse.json({ data: await updateFinancialEntry(ctx, params.entryId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_LANCAMENTO_EVENTO');
  }
}
