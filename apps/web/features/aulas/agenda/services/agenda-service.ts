import type {
  CreateCalendarEventInputDTO,
  ListCalendarEventsQueryDTO,
  ListCalendarEventsResultDTO,
  ListAgendaOperationLogsQueryDTO,
  RebuildAgendaWindowInputDTO,
  UpdateCalendarEventInputDTO,
} from '@/features/aulas/dtos';
import {
  mapCalendarEventDetailsResult,
  mapListAgendaOperationLogsResult,
  mapListCalendarEventsResult,
  mapRebuildAgendaWindowResult,
} from '@/features/aulas/mappers';
import { buildQueryString, requestJson } from '@/features/aulas/calendar/services/aulas-api';

const AGENDA_EVENTS_CACHE_TTL_MS = 30_000;

const agendaEventsCache = new Map<string, { expiresAt: number; value: ListCalendarEventsResultDTO }>();
const agendaEventsInFlight = new Map<string, Promise<ListCalendarEventsResultDTO>>();

function getAgendaEventsCacheKey(query: Partial<ListCalendarEventsQueryDTO>) {
  return buildQueryString(query as Record<string, unknown>) || '__default__';
}

export function invalidateAgendaEventsCache() {
  agendaEventsCache.clear();
  agendaEventsInFlight.clear();
}

export async function listAgendaEvents(query: Partial<ListCalendarEventsQueryDTO>) {
  const cacheKey = getAgendaEventsCacheKey(query);
  const cached = agendaEventsCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inFlight = agendaEventsInFlight.get(cacheKey);

  if (inFlight) {
    return inFlight;
  }

  const search = buildQueryString(query as Record<string, unknown>);
  const request = requestJson<Record<string, unknown>>(`/api/aulas/agenda?${search}`).then((result) => {
    const parsed = mapListCalendarEventsResult(result);

    agendaEventsCache.set(cacheKey, {
      expiresAt: Date.now() + AGENDA_EVENTS_CACHE_TTL_MS,
      value: parsed,
    });

    return parsed;
  });

  agendaEventsInFlight.set(cacheKey, request);

  try {
    return await request;
  } finally {
    agendaEventsInFlight.delete(cacheKey);
  }
}

export async function getAgendaEvent(eventId: string) {
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/agenda/${eventId}`);
  return mapCalendarEventDetailsResult(result);
}

export async function createAgendaEvent(input: CreateCalendarEventInputDTO) {
  const result = await requestJson<Record<string, unknown>>('/api/aulas/agenda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  invalidateAgendaEventsCache();

  return mapCalendarEventDetailsResult(result);
}

export async function updateAgendaEvent(eventId: string, input: UpdateCalendarEventInputDTO) {
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/agenda/${eventId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  invalidateAgendaEventsCache();

  return mapCalendarEventDetailsResult(result);
}

export async function listAgendaOperationLogs(query: Partial<ListAgendaOperationLogsQueryDTO> = {}) {
  const search = buildQueryString(query as Record<string, unknown>);
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/agenda/logs?${search}`);
  return mapListAgendaOperationLogsResult(result);
}

export async function rebuildAgendaWindow(input: RebuildAgendaWindowInputDTO = {}) {
  const result = await requestJson<Record<string, unknown>>('/api/aulas/agenda/rebuild', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  invalidateAgendaEventsCache();

  return mapRebuildAgendaWindowResult(result);
}
