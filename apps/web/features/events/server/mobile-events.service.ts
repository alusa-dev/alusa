import {
  createCostumeAssignment,
  createFinancialEntry,
  EventsError,
  getEventScopedResources,
  getSchoolEvent,
  listCostumes,
  listFinancialEntriesPage,
  listEventParticipantsPage,
  listSchoolEvents,
  updateFinancialEntry,
  updateSchoolEventStatus,
} from '@alusa/lib/events/events.service';
import {
  markEventTicketUsed,
  markEventTicketUsedAcrossEvents,
  verifyEventTicketForCheckIn,
  verifyEventTicketForCheckInAcrossEvents,
} from '@alusa/lib/events/ticket-checkin.service';
import type {
  CreateCostumeAssignmentInput,
  CreateEventFinancialEntryInput,
  ListFinancialEntriesQuery,
  ListEventParticipantsQuery,
  UpdateEventFinancialEntryInput,
  ListSchoolEventsQuery,
} from '@alusa/lib/events/events.schema';
import type { SchoolEventDTO } from '@alusa/lib/events/events.service';

export type MobileEventsActor = {
  userId: string;
  contaId: string;
  role: string;
};

export class MobileEventsForbiddenError extends Error {
  constructor(message = 'Você não tem permissão para acessar os eventos.') {
    super(message);
    this.name = 'MobileEventsForbiddenError';
  }
}

const EVENT_VIEW_ROLES = new Set(['ADMIN', 'RECEPCAO', 'FINANCEIRO', 'PROFESSOR']);
const TICKET_SCAN_ROLES = new Set(['ADMIN', 'RECEPCAO', 'FINANCEIRO']);
const EVENT_FINANCE_VIEW_ROLES = new Set(['ADMIN', 'RECEPCAO', 'FINANCEIRO']);
const EVENT_FINANCE_ROLES = new Set(['ADMIN', 'FINANCEIRO']);
const EVENT_COSTUME_MANAGE_ROLES = new Set(['ADMIN', 'RECEPCAO']);
const EVENT_FINISH_ROLES = new Set(['ADMIN', 'RECEPCAO']);

type MobileEventMetrics = Omit<
  Pick<
    SchoolEventDTO['metrics'],
    | 'receitaPrevista'
    | 'receitaRealizada'
    | 'custoRealizado'
    | 'resultadoRealizado'
    | 'ingressosVendidos'
    | 'ingressosDisponiveis'
    | 'taxaOcupacao'
    | 'figurinosPendentes'
    | 'figurinosEntregues'
    | 'figurinosDevolvidos'
  >,
  'receitaPrevista' | 'receitaRealizada' | 'custoRealizado' | 'resultadoRealizado'
> & {
  receitaPrevista: number | null;
  receitaRealizada: number | null;
  custoRealizado: number | null;
  resultadoRealizado: number | null;
};

type MobileEventCounts = Pick<
  SchoolEventDTO['counts'],
  'lots' | 'ticketSales' | 'costumes' | 'costumeAssignments' | 'financialEntries'
>;

export type MobileEventCapabilities = {
  canViewFinancial: boolean;
  canCreateFinancial: boolean;
  canManageFinancial: boolean;
  canManageCostumes: boolean;
  canFinish: boolean;
  canReactivate: boolean;
};

export type MobileEvent = {
  id: string;
  name: string;
  description: string | null;
  type: SchoolEventDTO['type'];
  status: SchoolEventDTO['status'];
  startsAt: string;
  endsAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  estimatedCapacity: number | null;
  hasTickets: boolean;
  ticketMode: SchoolEventDTO['ticketMode'];
  hasCostumes: boolean;
  hasFinancialControl: boolean;
  notes: string | null;
  capabilities: MobileEventCapabilities;
  metrics: MobileEventMetrics;
  counts: MobileEventCounts;
};

function assertRole(actor: MobileEventsActor, roles: Set<string>, message: string) {
  if (!actor.userId || !actor.contaId || !roles.has(actor.role.toUpperCase())) {
    throw new MobileEventsForbiddenError(message);
  }
}

function getEventCapabilities(actor: MobileEventsActor): MobileEventCapabilities {
  const role = actor.role.toUpperCase();
  return {
    canViewFinancial: EVENT_FINANCE_VIEW_ROLES.has(role),
    canCreateFinancial: EVENT_FINANCE_ROLES.has(role),
    canManageFinancial: EVENT_FINANCE_ROLES.has(role),
    canManageCostumes: EVENT_COSTUME_MANAGE_ROLES.has(role),
    canFinish: EVENT_FINISH_ROLES.has(role),
    canReactivate: EVENT_FINISH_ROLES.has(role),
  };
}

function mapEvent(event: SchoolEventDTO, capabilities: MobileEventCapabilities): MobileEvent {
  return {
    id: event.id,
    name: event.name,
    description: event.description,
    type: event.type,
    status: event.status,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    estimatedCapacity: event.estimatedCapacity,
    hasTickets: event.hasTickets,
    ticketMode: event.ticketMode,
    hasCostumes: event.hasCostumes,
    hasFinancialControl: event.hasFinancialControl,
    notes: event.notes,
    capabilities,
    metrics: {
      receitaPrevista: capabilities.canViewFinancial ? event.metrics.receitaPrevista : null,
      receitaRealizada: capabilities.canViewFinancial ? event.metrics.receitaRealizada : null,
      custoRealizado: capabilities.canViewFinancial ? event.metrics.custoRealizado : null,
      resultadoRealizado: capabilities.canViewFinancial ? event.metrics.resultadoRealizado : null,
      ingressosVendidos: event.metrics.ingressosVendidos,
      ingressosDisponiveis: event.metrics.ingressosDisponiveis,
      taxaOcupacao: event.metrics.taxaOcupacao,
      figurinosPendentes: event.metrics.figurinosPendentes,
      figurinosEntregues: event.metrics.figurinosEntregues,
      figurinosDevolvidos: event.metrics.figurinosDevolvidos,
    },
    counts: {
      lots: event.counts.lots,
      ticketSales: event.counts.ticketSales,
      costumes: event.counts.costumes,
      costumeAssignments: event.counts.costumeAssignments,
      financialEntries: event.counts.financialEntries,
    },
  };
}

function mapTicketEvent(event: Pick<SchoolEventDTO, 'id' | 'name' | 'status' | 'startsAt'>) {
  return {
    id: event.id,
    name: event.name,
    status: event.status,
    startsAt: event.startsAt,
  };
}

export async function listMobileEvents(
  actor: MobileEventsActor,
  query: Partial<Pick<ListSchoolEventsQuery, 'page' | 'pageSize' | 'search' | 'status' | 'type' | 'hasTickets'>> = {},
) {
  assertRole(actor, EVENT_VIEW_ROLES, 'Você não tem permissão para acessar os eventos.');

  const result = await listSchoolEvents(
    { contaId: actor.contaId },
    {
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 100, 100),
      search: query.search,
      status: query.status,
      type: query.type,
      hasTickets: query.hasTickets,
    },
  );

  return {
    events: result.data.filter((event) => event.status !== 'ARCHIVED').map((event) => mapEvent(event, getEventCapabilities(actor))),
    meta: result.meta,
  };
}

export async function getMobileEvent(actor: MobileEventsActor, eventId: string) {
  assertRole(actor, EVENT_VIEW_ROLES, 'Você não tem permissão para acessar os eventos.');
  const event = await getSchoolEvent({ contaId: actor.contaId }, eventId);
  if (event.status === 'ARCHIVED') {
    throw new EventsError('EVENTO_ARQUIVADO', 'Este evento não está disponível no mobile.', 404);
  }
  return { event: mapEvent(event, getEventCapabilities(actor)) };
}

async function getAvailableMobileEvent(actor: MobileEventsActor, eventId: string) {
  assertRole(actor, EVENT_VIEW_ROLES, 'Você não tem permissão para acessar os eventos.');
  const event = await getSchoolEvent({ contaId: actor.contaId }, eventId);
  if (event.status === 'ARCHIVED') {
    throw new EventsError('EVENTO_ARQUIVADO', 'Este evento não está disponível no mobile.', 404);
  }
  return event;
}

function assertFinancialControlEnabled(event: SchoolEventDTO) {
  if (!event.hasFinancialControl) {
    throw new EventsError('CONTROLE_FINANCEIRO_DESATIVADO', 'O controle financeiro está desativado neste evento.', 409);
  }
}

export async function listMobileEventFinancialEntries(
  actor: MobileEventsActor,
  eventId: string,
  page = 1,
  pageSize = 10,
  filters: Pick<ListFinancialEntriesQuery, 'type' | 'status' | 'search'> = {},
) {
  const event = await getAvailableMobileEvent(actor, eventId);
  assertRole(actor, EVENT_FINANCE_VIEW_ROLES, 'Você não tem permissão para acessar os lançamentos financeiros.');
  assertFinancialControlEnabled(event);
  return listFinancialEntriesPage({ contaId: actor.contaId }, { eventId, page, pageSize, ...filters });
}

export async function listMobileEventParticipants(
  actor: MobileEventsActor,
  eventId: string,
  query: Partial<Pick<ListEventParticipantsQuery, 'page' | 'pageSize' | 'search' | 'status'>> = {},
) {
  await getAvailableMobileEvent(actor, eventId);
  assertRole(actor, EVENT_VIEW_ROLES, 'Você não tem permissão para acessar os alunos inscritos.');
  return listEventParticipantsPage(
    { contaId: actor.contaId },
    eventId,
    {
      page: query.page ?? 1,
      pageSize: Math.min(query.pageSize ?? 10, 10),
      search: query.search,
      status: query.status,
    },
  );
}

export async function createMobileEventFinancialEntry(
  actor: MobileEventsActor,
  eventId: string,
  input: CreateEventFinancialEntryInput,
) {
  const event = await getAvailableMobileEvent(actor, eventId);
  assertRole(actor, EVENT_FINANCE_ROLES, 'Você não tem permissão para registrar custos ou receitas.');
  assertFinancialControlEnabled(event);
  return {
    entry: await createFinancialEntry({ contaId: actor.contaId, userId: actor.userId }, { ...input, eventId }),
  };
}

export async function updateMobileEventFinancialEntry(
  actor: MobileEventsActor,
  eventId: string,
  entryId: string,
  input: UpdateEventFinancialEntryInput,
) {
  const event = await getAvailableMobileEvent(actor, eventId);
  assertRole(actor, EVENT_FINANCE_ROLES, 'Você não tem permissão para corrigir lançamentos financeiros.');
  assertFinancialControlEnabled(event);
  return {
    entry: await updateFinancialEntry(
      { contaId: actor.contaId, userId: actor.userId },
      entryId,
      input,
      eventId,
    ),
  };
}

export async function getMobileEventCostumeResources(actor: MobileEventsActor, eventId: string) {
  const event = await getAvailableMobileEvent(actor, eventId);
  assertRole(actor, EVENT_VIEW_ROLES, 'Você não tem permissão para acessar os figurinos.');
  if (!event.hasCostumes) {
    throw new EventsError('FIGURINOS_DESATIVADOS', 'Este evento não possui controle de figurinos.', 409);
  }
  const [costumes, resources] = await Promise.all([
    listCostumes({ contaId: actor.contaId }, { eventId }),
    getEventScopedResources({ contaId: actor.contaId }, eventId),
  ]);
  return {
    costumes,
    resources: { alunos: resources.alunos, turmas: resources.turmas },
  };
}

export async function createMobileCostumeAssignment(
  actor: MobileEventsActor,
  eventId: string,
  input: CreateCostumeAssignmentInput,
) {
  await getAvailableMobileEvent(actor, eventId);
  assertRole(actor, EVENT_COSTUME_MANAGE_ROLES, 'Você não tem permissão para vincular figurinos.');
  return {
    assignment: await createCostumeAssignment({ contaId: actor.contaId, userId: actor.userId }, { ...input, eventId }),
  };
}

export async function finishMobileEvent(actor: MobileEventsActor, eventId: string) {
  await getAvailableMobileEvent(actor, eventId);
  assertRole(actor, EVENT_FINISH_ROLES, 'Você não tem permissão para encerrar eventos.');
  const event = await updateSchoolEventStatus({ contaId: actor.contaId, userId: actor.userId }, eventId, 'FINISHED');
  return { event: mapEvent(event, getEventCapabilities(actor)) };
}

export async function reactivateMobileEvent(actor: MobileEventsActor, eventId: string) {
  await getAvailableMobileEvent(actor, eventId);
  assertRole(actor, EVENT_FINISH_ROLES, 'Você não tem permissão para reativar eventos.');
  const event = await updateSchoolEventStatus({ contaId: actor.contaId, userId: actor.userId }, eventId, 'ACTIVE');
  return { event: mapEvent(event, getEventCapabilities(actor)) };
}

export async function verifyMobileTicket(
  actor: MobileEventsActor,
  eventId: string,
  ticketCode: string,
  confirm = false,
) {
  assertRole(actor, TICKET_SCAN_ROLES, 'Você não tem permissão para validar ingressos.');

  const event = await getSchoolEvent({ contaId: actor.contaId }, eventId);

  if (confirm) {
    const result = await markEventTicketUsed(actor.contaId, eventId, ticketCode, actor.userId);
    return { ...result, event: mapTicketEvent(event) };
  }

  const ticket = await verifyEventTicketForCheckIn(actor.contaId, eventId, ticketCode);
  return { event: mapTicketEvent(event), ticket };
}

export async function verifyMobileTicketByCode(
  actor: MobileEventsActor,
  ticketCode: string,
  confirm = false,
) {
  assertRole(actor, TICKET_SCAN_ROLES, 'Você não tem permissão para validar ingressos.');

  const resolved = await verifyEventTicketForCheckInAcrossEvents(actor.contaId, ticketCode);
  if (confirm) {
    return markEventTicketUsedAcrossEvents(actor.contaId, ticketCode, actor.userId);
  }

  return resolved;
}
