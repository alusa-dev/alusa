import { NextRequest, NextResponse } from 'next/server';

import { refundTicketSale, ticketSaleActionSchema } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// In Next.js App Router, dynamic route params are asynchronous. Keeping this
// typed as a plain object makes `params.saleId` undefined at runtime and causes
// Prisma to receive `where: { id: undefined }`.
type RouteParams = { params: Promise<{ saleId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await getEventsContext('eventTickets.cancelSale');
    const body = ticketSaleActionSchema.parse(await request.json().catch(() => ({})));
    const { saleId } = await params;
    if (!saleId?.trim()) {
      return NextResponse.json({ error: 'Venda de ingresso não informada.' }, { status: 400 });
    }
    return NextResponse.json({ data: await refundTicketSale(ctx, saleId, body.reason) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ESTORNAR_VENDA_EVENTO');
  }
}
