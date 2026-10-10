import { NextRequest, NextResponse } from 'next/server';

import { createEventCostPaymentSchema, deleteEventFinancialEntryParamsSchema, updateEventFinancialEntrySchema } from '@alusa/lib/events/events.schema';
import { deleteEventCost, registerEventCostPayment, updateFinancialEntry } from '@alusa/finance';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ entryId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { entryId } = deleteEventFinancialEntryParamsSchema.parse(await params);
    const ctx = await getEventsContext('eventFinance.cancelEntry');
    return NextResponse.json({ data: await deleteEventCost(ctx, entryId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_EXCLUIR_CUSTO_EVENTO');
  }
}

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
    const { entryId } = await params;
    return NextResponse.json({ data: await updateFinancialEntry(ctx, entryId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_LANCAMENTO_EVENTO');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const body = createEventCostPaymentSchema.parse(await request.json());
    const ctx = await getEventsContext('eventFinance.registerCostPayment');
    const { entryId } = await params;
    return NextResponse.json({ data: await registerEventCostPayment(ctx, entryId, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REGISTRAR_PAGAMENTO_CUSTO_EVENTO');
  }
}
