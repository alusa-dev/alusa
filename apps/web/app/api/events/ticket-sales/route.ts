import { NextRequest, NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';
import {
  createTicketSale,
  createTicketSaleSchema,
  listByEventQuerySchema,
  listTicketSales,
} from '@alusa/lib';

import { getEventsContext, handleEventsRouteError, queryObject } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventTickets.view');
    const query = listByEventQuerySchema.parse(queryObject(request));
    return NextResponse.json({ data: await listTicketSales(ctx, { eventId: query.eventId }) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_VENDAS_EVENTO');
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getEventsContext('eventTickets.createSale');
    const body = createTicketSaleSchema.parse(await request.json());
    const data = await createTicketSale(ctx, body);

    // A baixa manual cria o efeito de e-mail na outbox dentro da transação.
    // Drenamos somente depois do commit; se o Resend falhar, a venda continua
    // confirmada e a outbox permanece disponível para retry pelo job.
    await drainFinanceWebhookSideEffectOutbox({ contaId: ctx.contaId, limit: 5 }).catch((error) => {
      console.warn('[Ticket Sale] Falha não crítica ao disparar e-mail do ingresso', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_VENDA_EVENTO');
  }
}
