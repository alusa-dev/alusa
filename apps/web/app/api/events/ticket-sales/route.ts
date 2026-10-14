import { after, NextRequest, NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';
import { createTicketSaleSchema, listByEventQuerySchema } from '@alusa/lib/events/events.schema';
import { createTicketSale } from '@alusa/finance';
import { listTicketSales } from '@alusa/lib/events/events.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { dispatchStaffSaleTicketWhatsAppNotifications } from '@/src/server/events/event-ticket-whatsapp-outbox.service';

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

    const saleIds = [...new Set([data.id, ...('groupedSaleIds' in data ? data.groupedSaleIds : [])])];
    const requestId = getRequestId(request);
    after(async () => {
      const startedAt = Date.now();
      try {
        const statuses = await dispatchStaffSaleTicketWhatsAppNotifications({ contaId: ctx.contaId, saleIds });
        logApiOperationalEvent({
          severity: statuses.some((status) => status === 'FAILED' || status === 'DLQ') ? 'warn' : 'info',
          eventName: 'api.events.ticket_sale.whatsapp_outbox.dispatched',
          route: '/api/events/ticket-sales',
          method: 'POST',
          requestId,
          itemCount: statuses.length,
          durationMs: Date.now() - startedAt,
          result: statuses.join(',') || 'NO_PENDING_NOTIFICATION',
        });
      } catch (error) {
        logApiOperationalEvent({
          severity: 'warn',
          eventName: 'api.events.ticket_sale.whatsapp_outbox_dispatch.failed',
          route: '/api/events/ticket-sales',
          method: 'POST',
          requestId,
          itemCount: saleIds.length,
          durationMs: Date.now() - startedAt,
          error,
        });
      }
    });

    // A baixa manual cria o efeito de e-mail na outbox dentro da transação.
    // Drenamos somente depois do commit; se o Resend falhar, a venda continua
    // confirmada e a outbox permanece disponível para retry pelo job.
    await drainFinanceWebhookSideEffectOutbox({ contaId: ctx.contaId, limit: 5 }).catch((error) => {
      logApiOperationalEvent({
        severity: 'warn',
        eventName: 'api.events.ticket_sale.email_outbox_drain.failed',
        route: '/api/events/ticket-sales',
        method: 'POST',
        requestId: getRequestId(request),
        error,
      });
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CRIAR_VENDA_EVENTO');
  }
}
