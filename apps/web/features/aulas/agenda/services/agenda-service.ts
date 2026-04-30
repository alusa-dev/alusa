import type {
  CreateCalendarEventInputDTO,
  ListCalendarEventsQueryDTO,
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

export async function listAgendaEvents(query: Partial<ListCalendarEventsQueryDTO>) {
  const search = buildQueryString(query as Record<string, unknown>);
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/agenda?${search}`);
  return mapListCalendarEventsResult(result);
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
  return mapCalendarEventDetailsResult(result);
}

export async function updateAgendaEvent(eventId: string, input: UpdateCalendarEventInputDTO) {
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/agenda/${eventId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
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
  return mapRebuildAgendaWindowResult(result);
}
