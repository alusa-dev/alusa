import type { Prisma } from '@prisma/client';
import { EventsError, recordEventAudit } from '@alusa/lib/events/events.service';
import { createEventTicketScannerToken, type EventTicketScannerTokenClaims } from './event-ticket-scanner-token';

type Tx = Prisma.TransactionClient;

const closedEventStatuses = new Set(['FINISHED', 'CANCELLED', 'ARCHIVED']);

function assertEventOpen(status: string) {
  if (closedEventStatuses.has(status)) {
    throw new EventsError('EVENTO_INDISPONIVEL', 'O acesso do leitor está encerrado para este evento.', 410);
  }
}

export async function listEventTicketScannerAccesses(tx: Tx, contaId: string, eventId: string) {
  const event = await tx.schoolEvent.findFirst({
    where: { id: eventId, contaId },
    select: { id: true, status: true },
  });
  if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);

  const items = await tx.eventTicketScannerAccess.findMany({
    where: { contaId, eventId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      operatorName: true,
      gateName: true,
      createdAt: true,
      createdBy: { select: { nome: true } },
    },
  });
  const isActive = !closedEventStatuses.has(event.status);
  return {
    items: items.map((item) => ({
      id: item.id,
      operatorName: item.operatorName,
      gateName: item.gateName,
      createdAt: item.createdAt.toISOString(),
      createdByName: item.createdBy?.nome ?? 'Usuário removido',
      status: isActive ? 'ACTIVE' as const : 'CLOSED' as const,
    })),
  };
}

export async function createEventTicketScannerAccess(
  tx: Tx,
  input: { contaId: string; eventId: string; actorUserId: string; operatorName: string; gateName: string },
) {
  const event = await tx.schoolEvent.findFirst({
    where: { id: input.eventId, contaId: input.contaId },
    select: { id: true, status: true, hasTickets: true },
  });
  if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
  assertEventOpen(event.status);
  if (!event.hasTickets) throw new EventsError('EVENTO_SEM_INGRESSOS', 'Este evento não possui ingressos.', 409);

  const access = await tx.eventTicketScannerAccess.create({
    data: {
      contaId: input.contaId,
      eventId: input.eventId,
      operatorName: input.operatorName,
      gateName: input.gateName,
      createdByUserId: input.actorUserId,
    },
    select: { id: true, operatorName: true, gateName: true, createdAt: true },
  });
  await recordEventAudit(tx, {
    contaId: input.contaId,
    eventId: input.eventId,
    actorUserId: input.actorUserId,
    action: 'events.ticket_scanner_access.created',
    entityType: 'EventTicketScannerAccess',
    entityId: access.id,
    after: { operatorName: access.operatorName, gateName: access.gateName },
  });
  return {
    ...access,
    createdAt: access.createdAt.toISOString(),
    token: createEventTicketScannerToken({ accessId: access.id, contaId: input.contaId }),
  };
}

export async function regenerateEventTicketScannerLink(tx: Tx, contaId: string, eventId: string, accessId: string) {
  const access = await tx.eventTicketScannerAccess.findFirst({
    where: { id: accessId, contaId, eventId },
    select: { id: true },
  });
  if (!access) throw new EventsError('ACESSO_NAO_ENCONTRADO', 'Acesso do leitor não encontrado.', 404);
  const event = await tx.schoolEvent.findFirst({
    where: { id: eventId, contaId },
    select: { status: true },
  });
  if (!event) throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
  assertEventOpen(event.status);
  return { token: createEventTicketScannerToken({ accessId: access.id, contaId }) };
}

export async function deleteEventTicketScannerAccess(
  tx: Tx,
  input: { contaId: string; eventId: string; accessId: string; actorUserId: string },
) {
  const access = await tx.eventTicketScannerAccess.findFirst({
    where: { id: input.accessId, contaId: input.contaId, eventId: input.eventId },
    select: { id: true, operatorName: true, gateName: true, createdByUserId: true },
  });
  if (!access) throw new EventsError('ACESSO_NAO_ENCONTRADO', 'Acesso do leitor não encontrado.', 404);

  await recordEventAudit(tx, {
    contaId: input.contaId,
    eventId: input.eventId,
    actorUserId: input.actorUserId,
    action: 'events.ticket_scanner_access.deleted',
    entityType: 'EventTicketScannerAccess',
    entityId: access.id,
    before: {
      operatorName: access.operatorName,
      gateName: access.gateName,
      createdByUserId: access.createdByUserId,
    },
  });
  const deleted = await tx.eventTicketScannerAccess.deleteMany({
    where: { id: access.id, contaId: input.contaId, eventId: input.eventId },
  });
  if (deleted.count !== 1) throw new EventsError('ACESSO_NAO_ENCONTRADO', 'Acesso do leitor não encontrado.', 404);
  return { success: true as const };
}

export async function findPublicEventTicketScannerAccess(tx: Tx, claims: EventTicketScannerTokenClaims) {
  const access = await tx.eventTicketScannerAccess.findFirst({
    where: { id: claims.accessId, contaId: claims.contaId },
    select: {
      id: true,
      contaId: true,
      eventId: true,
      operatorName: true,
      gateName: true,
      event: { select: { id: true, contaId: true, name: true, status: true } },
    },
  });
  if (!access || access.event.contaId !== claims.contaId || access.eventId !== access.event.id) {
    throw new EventsError('ACESSO_NAO_ENCONTRADO', 'Link do leitor inválido ou removido.', 404);
  }
  assertEventOpen(access.event.status);
  return access;
}
