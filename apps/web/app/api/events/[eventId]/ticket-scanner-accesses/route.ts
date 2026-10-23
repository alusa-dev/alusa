import { NextRequest, NextResponse } from 'next/server';
import { eventRouteParamsDTOSchema, eventTicketScannerAccessInputDTOSchema } from '@/features/events/dtos';
import { runWithTenant } from '@/lib/prisma-tenant';
import {
  createEventTicketScannerAccess,
  listEventTicketScannerAccesses,
} from '@/src/server/events/event-ticket-scanner-access';
import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ eventId: string }> };

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId } = eventRouteParamsDTOSchema.parse(await params);
    const context = await getEventsContext('eventTickets.manageScannerAccess', { requireWrite: false });
    const data = await runWithTenant(context.contaId, (tx) =>
      listEventTicketScannerAccesses(tx, context.contaId, eventId),
    );
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_LISTAR_ACESSOS_LEITOR'));
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { eventId } = eventRouteParamsDTOSchema.parse(await params);
    const input = eventTicketScannerAccessInputDTOSchema.parse(await request.json());
    const context = await getEventsContext('eventTickets.manageScannerAccess');
    const data = await runWithTenant(context.contaId, (tx) => createEventTicketScannerAccess(tx, {
      contaId: context.contaId,
      eventId,
      actorUserId: context.userId,
      ...input,
    }));
    return noStore(NextResponse.json({ data }, { status: 201 }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_CRIAR_ACESSO_LEITOR'));
  }
}
