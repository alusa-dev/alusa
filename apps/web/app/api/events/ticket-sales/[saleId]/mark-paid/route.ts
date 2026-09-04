import { NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';
import { markTicketSalePaid } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: { saleId: string } };

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await getEventsContext('eventTickets.markPaid');
    const data = await markTicketSalePaid(ctx, params.saleId);

    // O efeito só é drenado após o commit da baixa. Em caso de indisponibilidade
    // do Resend, a outbox preserva o envio para retry posterior.
    await drainFinanceWebhookSideEffectOutbox({ contaId: ctx.contaId, limit: 5 }).catch((error) => {
      console.warn('[Ticket Sale] Falha não crítica ao disparar e-mail do ingresso', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_MARCAR_VENDA_PAGA');
  }
}
