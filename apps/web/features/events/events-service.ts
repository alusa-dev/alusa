'use client';

import type {
  EventCostumeAssignmentStatus,
  EventCostumeCategory,
  EventFinancialEntryStatus,
  EventFinancialEntryType,
  EventPaymentMethod,
  EventTicketLotStatus,
  EventTicketSaleStatus,
  EventTicketType,
  SchoolEventStatus,
  SchoolEventType,
} from '@alusa/shared';
import type { SchoolEventDTO } from '@alusa/lib';

export type { SchoolEventDTO };

export type EventListResult = {
  data: SchoolEventDTO[];
  summary: {
    active: number;
    planning: number;
    receitaPrevista: number;
    receitaRealizada: number;
    custoRealizado: number;
    resultadoPrevisto: number;
  };
  meta: { total: number; page: number; pageSize: number; pageCount: number };
};

export type EventResources = {
  users: Array<{ id: string; nome: string; email: string | null; role: string }>;
  alunos: Array<{ id: string; nome: string }>;
  responsaveis: Array<{ id: string; nome: string }>;
  turmas: Array<{ id: string; nome: string }>;
  events: Array<{ id: string; name: string; startsAt: string; status: SchoolEventStatus }>;
};

export type TicketLotDTO = {
  id: string;
  eventId: string;
  event: { id: string; name: string; startsAt: string };
  name: string;
  ticketType: EventTicketType;
  unitPrice: number;
  quantityTotal: number;
  quantitySold: number;
  quantityAvailable: number;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  status: EventTicketLotStatus;
  notes: string | null;
};

export type TicketSaleDTO = {
  id: string;
  eventId: string;
  event: { id: string; name: string; startsAt: string };
  lotId: string;
  lot: { id: string; name: string; ticketType: EventTicketType };
  buyerName: string;
  aluno: { id: string; nome: string } | null;
  responsavel: { id: string; nome: string } | null;
  quantity: number;
  unitPriceSnapshot: number;
  totalAmount: number;
  paymentMethod: EventPaymentMethod;
  status: EventTicketSaleStatus;
  soldAt: string;
  paidAt: string | null;
  notes: string | null;
};

export type CostumeDTO = {
  id: string;
  eventId: string;
  event: { id: string; name: string; startsAt: string };
  name: string;
  description: string | null;
  category: EventCostumeCategory;
  size: string | null;
  color: string | null;
  accessories: string | null;
  schoolCost: number | null;
  chargedValue: number | null;
  supplier: string | null;
  quantity: number;
  notes: string | null;
  assignmentsCount: number;
};

export type CostumeAssignmentDTO = {
  id: string;
  eventId: string;
  event: { id: string; name: string; startsAt: string };
  costumeId: string;
  costume: { id: string; name: string; category: EventCostumeCategory; size: string | null };
  aluno: { id: string; nome: string } | null;
  turma: { id: string; nome: string } | null;
  definedSize: string | null;
  status: EventCostumeAssignmentStatus;
  chargedValue: number | null;
  isPaid: boolean;
  deliveredAt: string | null;
  returnedAt: string | null;
  notes: string | null;
};

export type FinancialEntryDTO = {
  id: string;
  eventId: string;
  event: { id: string; name: string; startsAt: string };
  type: EventFinancialEntryType;
  category: string;
  description: string;
  supplier: string | null;
  originType: 'MANUAL' | 'TICKET_SALE' | 'COSTUME' | 'COSTUME_ASSIGNMENT';
  originId: string | null;
  expectedAmount: number;
  actualAmount: number | null;
  dueDate: string | null;
  realizedAt: string | null;
  status: EventFinancialEntryStatus;
  paymentMethod: EventPaymentMethod | null;
  notes: string | null;
};

export type EventAuditDTO = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string; nome: string; email: string | null } | null;
  metadata: unknown;
  createdAt: string;
};

export type EventReportsDTO = {
  general: {
    receita: number;
    custo: number;
    resultado: number;
    ingressos: number;
    lucrativos: number;
    prejuizo: number;
    margemMedia: number | null;
    ticketMedio: number | null;
    ranking: SchoolEventDTO[];
  };
  selected: SchoolEventDTO | null;
  compareWith: SchoolEventDTO | null;
  events: Array<{
    id: string;
    name: string;
    startsAt: string;
    status: SchoolEventStatus;
    type: SchoolEventType;
    metrics: SchoolEventDTO['metrics'];
  }>;
};

type JsonEnvelope<T> = { data: T };

async function parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível concluir a ação de Eventos.';
    throw new Error(message);
  }

  return json as T;
}

function buildParams(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export async function listEvents(params: Record<string, string | number | boolean | undefined> = {}) {
  const query = buildParams(params);
  return parseResponse<EventListResult>(await fetch(`/api/events?${query}`, { cache: 'no-store' }));
}

export async function getEvent(eventId: string) {
  const json = await parseResponse<JsonEnvelope<SchoolEventDTO>>(
    await fetch(`/api/events/${eventId}`, { cache: 'no-store' }),
  );
  return json.data;
}

export async function saveEvent(payload: Record<string, unknown>, eventId?: string) {
  const response = await fetch(eventId ? `/api/events/${eventId}` : '/api/events', {
    method: eventId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return (await parseResponse<JsonEnvelope<SchoolEventDTO>>(response)).data;
}

export async function updateEventStatus(eventId: string, status: SchoolEventStatus) {
  const response = await fetch(`/api/events/${eventId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return (await parseResponse<JsonEnvelope<SchoolEventDTO>>(response)).data;
}

export async function listResources() {
  return parseResponse<EventResources>(await fetch('/api/events/resources', { cache: 'no-store' }));
}

export async function listTicketLots(eventId?: string) {
  const query = buildParams({ eventId });
  return (await parseResponse<JsonEnvelope<TicketLotDTO[]>>(await fetch(`/api/events/ticket-lots?${query}`, { cache: 'no-store' }))).data;
}

export async function createTicketLot(payload: Record<string, unknown>) {
  return (await parseResponse<JsonEnvelope<TicketLotDTO>>(await fetch('/api/events/ticket-lots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).data;
}

export async function updateTicketLot(id: string, payload: Record<string, unknown>) {
  return (await parseResponse<JsonEnvelope<TicketLotDTO>>(await fetch(`/api/events/ticket-lots/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).data;
}

export async function listTicketSales(eventId?: string) {
  const query = buildParams({ eventId });
  return (await parseResponse<JsonEnvelope<TicketSaleDTO[]>>(await fetch(`/api/events/ticket-sales?${query}`, { cache: 'no-store' }))).data;
}

export async function createTicketSale(payload: Record<string, unknown>) {
  return (await parseResponse<JsonEnvelope<TicketSaleDTO>>(await fetch('/api/events/ticket-sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).data;
}

export async function markTicketSalePaid(id: string) {
  return (await parseResponse<JsonEnvelope<TicketSaleDTO>>(await fetch(`/api/events/ticket-sales/${id}/mark-paid`, { method: 'POST' }))).data;
}

export async function cancelTicketSale(id: string, reason?: string) {
  return (await parseResponse<JsonEnvelope<TicketSaleDTO>>(await fetch(`/api/events/ticket-sales/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  }))).data;
}

export async function refundTicketSale(id: string, reason?: string) {
  return (await parseResponse<JsonEnvelope<TicketSaleDTO>>(await fetch(`/api/events/ticket-sales/${id}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  }))).data;
}

export async function listCostumes(eventId?: string) {
  const query = buildParams({ eventId });
  return (await parseResponse<JsonEnvelope<CostumeDTO[]>>(await fetch(`/api/events/costumes?${query}`, { cache: 'no-store' }))).data;
}

export async function createCostume(payload: Record<string, unknown>) {
  return (await parseResponse<JsonEnvelope<CostumeDTO>>(await fetch('/api/events/costumes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).data;
}

export async function listCostumeAssignments(eventId?: string) {
  const query = buildParams({ eventId });
  return (await parseResponse<JsonEnvelope<CostumeAssignmentDTO[]>>(await fetch(`/api/events/costume-assignments?${query}`, { cache: 'no-store' }))).data;
}

export async function createCostumeAssignment(payload: Record<string, unknown>) {
  return (await parseResponse<JsonEnvelope<CostumeAssignmentDTO>>(await fetch('/api/events/costume-assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).data;
}

export async function updateCostumeAssignment(id: string, payload: Record<string, unknown>) {
  return (await parseResponse<JsonEnvelope<CostumeAssignmentDTO>>(await fetch(`/api/events/costume-assignments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).data;
}

export async function listFinancialEntries(eventId?: string, type?: EventFinancialEntryType) {
  const query = buildParams({ eventId, type });
  return (await parseResponse<JsonEnvelope<FinancialEntryDTO[]>>(await fetch(`/api/events/financial-entries?${query}`, { cache: 'no-store' }))).data;
}

export async function createFinancialEntry(payload: Record<string, unknown>) {
  return (await parseResponse<JsonEnvelope<FinancialEntryDTO>>(await fetch('/api/events/financial-entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).data;
}

export async function updateFinancialEntry(id: string, payload: Record<string, unknown>) {
  return (await parseResponse<JsonEnvelope<FinancialEntryDTO>>(await fetch(`/api/events/financial-entries/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))).data;
}

export async function listEventAudit(eventId: string) {
  return (await parseResponse<JsonEnvelope<EventAuditDTO[]>>(await fetch(`/api/events/${eventId}/audit`, { cache: 'no-store' }))).data;
}

export async function getEventReports(params: { eventId?: string; compareWithEventId?: string } = {}) {
  const query = buildParams(params);
  return parseResponse<EventReportsDTO>(await fetch(`/api/events/reports?${query}`, { cache: 'no-store' }));
}
