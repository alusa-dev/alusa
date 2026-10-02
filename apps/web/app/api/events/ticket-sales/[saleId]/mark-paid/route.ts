import { NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';
import { markTicketSalePaid } from '@alusa/lib/events/events.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: { saleId: string } };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await getEventsContext('eventTickets.markPaid');
    const data = await markTicketSalePaid(ctx, params.saleId);

    // O efeito só é drenado após o commit da baixa. Em caso de indisponibilidade
    // do Resend, a outbox preserva o envio para retry posterior.
    await drainFinanceWebhookSideEffectOutbox({ contaId: ctx.contaId, limit: 5 }).catch((error) => {
      logApiOperationalEvent({
        severity: 'warn',
        eventName: 'api.events.ticket_sale.email_outbox_drain.failed',
        route: '/api/events/ticket-sales/[saleId]/mark-paid',
        method: 'POST',
        requestId: getRequestId(request),
        error,
      });
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_MARCAR_VENDA_PAGA');
  }
}
