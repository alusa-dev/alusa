import type {
  AttendanceHistoryTurmaResultDTO,
  ListAttendanceQueryDTO,
  ListAttendanceWorkspaceQueryDTO,
  SaveAttendanceInputDTO,
} from '@/features/aulas/dtos';
import {
  mapAttendanceHistoryTurmaResult,
  mapAttendanceEventDetailsResult,
  mapAttendanceTurmaWorkspaceResult,
  mapAttendanceWorkspaceResult,
  mapListAttendanceResult,
} from '@/features/aulas/mappers';
import { invalidateAgendaEventsCache } from '@/features/aulas/agenda/services/agenda-service';
import { buildQueryString, requestJson } from '@/features/aulas/calendar/services/aulas-api';

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
