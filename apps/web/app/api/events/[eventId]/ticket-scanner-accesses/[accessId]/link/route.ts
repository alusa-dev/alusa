import { NextRequest, NextResponse } from 'next/server';
import { eventTicketScannerAccessIdParamsDTOSchema } from '@/features/events/dtos';
import { runWithTenant } from '@/lib/prisma-tenant';
import { regenerateEventTicketScannerLink } from '@/src/server/events/event-ticket-scanner-access';
import { getEventsContext, handleEventsRouteError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ eventId: string; accessId: string }> };

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, accessId } = eventTicketScannerAccessIdParamsDTOSchema.parse(await params);
    const context = await getEventsContext('eventTickets.manageScannerAccess');
    const data = await runWithTenant(context.contaId, (tx) =>
      regenerateEventTicketScannerLink(tx, context.contaId, eventId, accessId),
    );
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_LINK_ACESSO_LEITOR');
  }
}
