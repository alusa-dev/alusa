import type {
  AttendanceHistoryTurmaResultDTO,
  ListAttendanceQueryDTO,
  ListAttendanceWorkspaceQueryDTO,
  SaveAttendanceInputDTO,
} from '@/features/lessons/dtos';
import {
  mapAttendanceHistoryTurmaResult,
  mapAttendanceEventDetailsResult,
  mapAttendanceTurmaWorkspaceResult,
  mapAttendanceWorkspaceResult,
  mapListAttendanceResult,
} from '@/features/lessons/mappers';
import { invalidateAgendaEventsCache } from '@/features/lessons/agenda/services/agenda-service';
import { buildQueryString, requestJson } from '@/features/lessons/calendar/services/lessons-api';

export async function listAttendanceHistory(query: Partial<ListAttendanceQueryDTO>) {
  const search = buildQueryString(query as Record<string, unknown>);
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/frequencia?${search}`);
  return mapListAttendanceResult(result);
}

export async function listAttendanceHistoryTurma(
  turmaId: string,
  query: Partial<ListAttendanceQueryDTO>,
): Promise<AttendanceHistoryTurmaResultDTO> {
  const search = buildQueryString(query as Record<string, unknown>);
  const result = await requestJson<Record<string, unknown>>(
    `/api/aulas/frequencia/turmas/${turmaId}/historico?${search}`,
  );
  return mapAttendanceHistoryTurmaResult(result);
}

export async function listAttendanceWorkspace(query: Partial<ListAttendanceWorkspaceQueryDTO>) {
  const search = buildQueryString(query as Record<string, unknown>);
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/frequencia/workspace?${search}`);
  return mapAttendanceWorkspaceResult(result);
}

export async function getAttendanceTurmaWorkspace(
  turmaId: string,
  query: Partial<ListAttendanceWorkspaceQueryDTO>,
) {
  const search = buildQueryString(query as Record<string, unknown>);
  const result = await requestJson<Record<string, unknown>>(
    `/api/aulas/frequencia/turmas/${turmaId}?${search}`,
  );
  return mapAttendanceTurmaWorkspaceResult(result);
}

export async function getAttendanceEvent(eventId: string) {
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/frequencia/${eventId}`);
  return mapAttendanceEventDetailsResult(result);
}

export async function saveAttendanceEvent(eventId: string, input: SaveAttendanceInputDTO) {
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/frequencia/${eventId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  invalidateAgendaEventsCache();

  return mapAttendanceEventDetailsResult(result);
}
