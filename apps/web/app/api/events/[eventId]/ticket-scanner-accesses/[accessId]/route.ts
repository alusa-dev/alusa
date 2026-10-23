import { NextRequest, NextResponse } from 'next/server';
import { eventTicketScannerAccessIdParamsDTOSchema } from '@/features/events/dtos';
import { runWithTenant } from '@/lib/prisma-tenant';
import { deleteEventTicketScannerAccess } from '@/src/server/events/event-ticket-scanner-access';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ eventId: string; accessId: string }> };

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId, accessId } = eventTicketScannerAccessIdParamsDTOSchema.parse(await params);
    const context = await getEventsContext('eventTickets.manageScannerAccess');
    const data = await runWithTenant(context.contaId, (tx) => deleteEventTicketScannerAccess(tx, {
      contaId: context.contaId,
      eventId,
      accessId,
      actorUserId: context.userId,
    }));
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_EXCLUIR_ACESSO_LEITOR'));
  }
}
