import { NextRequest, NextResponse } from 'next/server';

import { createEventCostPaymentSchema } from '@alusa/lib/events/events.schema';
import { registerCostumeAssignmentPayment } from '@alusa/finance';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ entryId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const body = createEventCostPaymentSchema.parse(await request.json());
    const ctx = await getEventsContext('eventFinance.registerCostumePayment');
    const { entryId } = await params;
    return NextResponse.json({ data: await registerCostumeAssignmentPayment(ctx, entryId, body) }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REGISTRAR_RECEBIMENTO_FIGURINO');
  }
}
