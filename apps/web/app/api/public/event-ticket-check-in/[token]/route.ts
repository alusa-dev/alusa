import { NextRequest, NextResponse } from 'next/server';
import { verifyEventMapTicketForCheckIn, markEventMapTicketUsed } from '@alusa/lib/events/map/event-map.service';
import { EventsError } from '@alusa/lib/events/events.service';
import {
  publicEventTicketScannerInputDTOSchema,
  publicEventTicketScannerTokenParamsDTOSchema,
} from '@/features/events/dtos';
import { runWithTenant } from '@/lib/prisma-tenant';
import {
  findPublicEventTicketScannerAccess,
} from '@/src/server/events/event-ticket-scanner-access';
import { verifyEventTicketScannerToken } from '@/src/server/events/event-ticket-scanner-token';
import { handleEventsRouteError } from '../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ token: string }> };

type PublicTicketCheckInDTO = {
  ticketCode: string;
  status: string;
  usedAt: string | null;
  buyerName: string;
  seat: { sectionName: string; seatLabel: string } | null;
};

function toPublicTicketDTO(ticket: Awaited<ReturnType<typeof verifyEventMapTicketForCheckIn>>): PublicTicketCheckInDTO {
  return {
    ticketCode: ticket.ticketCode,
    status: ticket.status,
    usedAt: ticket.usedAt,
    buyerName: ticket.order?.buyerName ?? ticket.sale?.buyerName ?? 'Comprador não identificado',
    seat: ticket.seat ? { sectionName: ticket.seat.sectionName, seatLabel: ticket.seat.seatLabel } : null,
  };
}

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

function getClaims(rawToken: string) {
  const { token } = publicEventTicketScannerTokenParamsDTOSchema.parse({ token: rawToken });
  const claims = verifyEventTicketScannerToken(token);
  if (!claims) throw new EventsError('ACESSO_NAO_ENCONTRADO', 'Link do leitor inválido ou removido.', 404);
  return claims;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const claims = getClaims((await params).token);
    const access = await runWithTenant(claims.contaId, (tx) => findPublicEventTicketScannerAccess(tx, claims));
    return noStore(NextResponse.json({ data: {
      event: { name: access.event.name },
      operatorName: access.operatorName,
      gateName: access.gateName,
    } }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_ACESSAR_LEITOR_PUBLICO'));
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const claims = getClaims((await params).token);
    const input = publicEventTicketScannerInputDTOSchema.parse(await request.json());
    const data = await runWithTenant(claims.contaId, async (tx) => {
      // Lock access and event through this transaction so a concurrent revoke
      // or event closure cannot race with a check-in already being processed.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT a."id"
        FROM "EventTicketScannerAccess" a
        INNER JOIN "SchoolEvent" e
          ON e."id" = a."eventId" AND e."contaId" = a."contaId"
        WHERE a."id" = ${claims.accessId} AND a."contaId" = ${claims.contaId}
        FOR SHARE OF a, e
      `;
      if (locked.length !== 1) throw new EventsError('ACESSO_NAO_ENCONTRADO', 'Link do leitor inválido ou removido.', 404);
      const access = await findPublicEventTicketScannerAccess(tx, claims);
      if (input.confirm) {
        const result = await markEventMapTicketUsed(claims.contaId, access.eventId, input.ticketCode, null, {
          tx,
          operatorName: access.operatorName,
          gateName: access.gateName,
          scannerAccessId: access.id,
        });
        return { ok: result.ok, alreadyUsed: result.alreadyUsed, ticket: toPublicTicketDTO(result.ticket) };
      }
      const ticket = await verifyEventMapTicketForCheckIn(claims.contaId, access.eventId, input.ticketCode, tx);
      return { ticket: toPublicTicketDTO(ticket) };
    });
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(handleEventsRouteError(error, 'ERRO_VERIFICAR_INGRESSO_PUBLICO'));
  }
}
