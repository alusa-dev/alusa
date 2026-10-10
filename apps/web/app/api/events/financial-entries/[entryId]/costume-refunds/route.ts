import { NextRequest, NextResponse } from 'next/server';

import { refundCostumeAssignmentPaymentSchema } from '@alusa/lib/events/events.schema';
import { refundCostumeAssignmentPayment } from '@alusa/finance';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ entryId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const body = refundCostumeAssignmentPaymentSchema.parse(await request.json());
    const ctx = await getEventsContext('eventFinance.cancelEntry');
    const { entryId } = await params;
    return NextResponse.json({ data: await refundCostumeAssignmentPayment(ctx, entryId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ESTORNAR_RECEBIMENTO_FIGURINO');
  }
}
