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
const AGENDA_EVENTS_CACHE_MAX_ENTRIES = 40;

const agendaEventsCache = new Map<string, { expiresAt: number; value: ListCalendarEventsResultDTO }>();
const agendaEventsInFlight = new Map<string, Promise<ListCalendarEventsResultDTO>>();

function getAgendaEventsCacheKey(query: Partial<ListCalendarEventsQueryDTO>) {
  return buildQueryString(query as Record<string, unknown>) || '__default__';
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

function touchAgendaCacheKey(key: string) {
  const entry = agendaEventsCache.get(key);
  if (!entry) return;
  agendaEventsCache.delete(key);
  agendaEventsCache.set(key, entry);
}

function pruneAgendaEventsCache() {
  while (agendaEventsCache.size > AGENDA_EVENTS_CACHE_MAX_ENTRIES) {
    const oldest = agendaEventsCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    agendaEventsCache.delete(oldest);
  }
}

function setAgendaCache(key: string, value: ListCalendarEventsResultDTO) {
  if (agendaEventsCache.has(key)) {
    agendaEventsCache.delete(key);
  }
  agendaEventsCache.set(key, {
    expiresAt: Date.now() + AGENDA_EVENTS_CACHE_TTL_MS,
    value,
  });
  pruneAgendaEventsCache();
}

export function invalidateAgendaEventsCache() {
  agendaEventsCache.clear();
  agendaEventsInFlight.clear();
}

export type ListAgendaEventsOptions = {
  signal?: AbortSignal;
};

export async function listAgendaEvents(
  query: Partial<ListCalendarEventsQueryDTO>,
  options?: ListAgendaEventsOptions,
) {
  const { signal } = options ?? {};

  throwIfAborted(signal);

  const cacheKey = getAgendaEventsCacheKey(query);
  const cached = agendaEventsCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    touchAgendaCacheKey(cacheKey);
    throwIfAborted(signal);
    return cached.value;
  }

  if (cached && cached.expiresAt <= Date.now()) {
    agendaEventsCache.delete(cacheKey);
  }

  throwIfAborted(signal);

  const execute = async () => {
    const search = buildQueryString(query as Record<string, unknown>);
    throwIfAborted(signal);
    const result = await requestJson<Record<string, unknown>>(`/api/aulas/agenda?${search}`, { signal });
    const parsed = mapListCalendarEventsResult(result);
    setAgendaCache(cacheKey, parsed);
    return parsed;
  };

  if (!signal) {
    const inFlight = agendaEventsInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = execute().finally(() => {
      agendaEventsInFlight.delete(cacheKey);
    });

    agendaEventsInFlight.set(cacheKey, request);
    return request;
  }

  return execute();
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
