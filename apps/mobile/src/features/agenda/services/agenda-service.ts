import { authenticatedApi } from '@/features/auth/services/auth-service';
import type {
  AgendaEventResponse,
  AgendaListResponse,
  AgendaResources,
  CalendarEventType,
  CreateAgendaEventInput,
  AttendanceResponse,
  UpdateAgendaEventInput,
} from '../types/agenda';

function queryString(input: Record<string, string | undefined | string[]>) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    params.set(key, Array.isArray(value) ? value.join(',') : value);
  });
  return params.toString();
}

export const agendaService = {
  listEvents(input: {
    start: string;
    end: string;
    viewMode: 'week' | 'month-detailed';
    filters?: { turmaId?: string; professorId?: string; salaId?: string; type?: CalendarEventType };
    signal?: AbortSignal;
  }) {
    const filters = input.filters ?? {};
    const search = queryString({
      start: input.start,
      end: input.end,
      viewMode: input.viewMode,
      turmaId: filters.turmaId,
      professorId: filters.professorId,
      salaId: filters.salaId,
      type: filters.type,
    });

    return authenticatedApi.request<AgendaListResponse>({
      method: 'GET',
      path: `/api/mobile/agenda?${search}`,
      signal: input.signal,
    });
  },

  listResources() {
    return authenticatedApi.request<{ resources: AgendaResources }>({
      method: 'GET',
      path: '/api/mobile/agenda/resources',
    });
  },

  getEvent(eventId: string) {
    return authenticatedApi.request<AgendaEventResponse>({
      method: 'GET',
      path: `/api/mobile/agenda/${encodeURIComponent(eventId)}`,
    });
  },

  createEvent(input: CreateAgendaEventInput) {
    return authenticatedApi.request<AgendaEventResponse, CreateAgendaEventInput>({
      method: 'POST',
      path: '/api/mobile/agenda',
      body: input,
    });
  },

  updateEvent(eventId: string, input: UpdateAgendaEventInput) {
    return authenticatedApi.request<AgendaEventResponse, UpdateAgendaEventInput>({
      method: 'PATCH',
      path: `/api/mobile/agenda/${encodeURIComponent(eventId)}`,
      body: input,
    });
  },

  getAttendance(eventId: string) {
    return authenticatedApi.request<AttendanceResponse>({
      method: 'GET',
      path: `/api/mobile/aulas/frequencia/${encodeURIComponent(eventId)}`,
    });
  },

  saveAttendance(eventId: string, items: Array<{ alunoId: string; matriculaId?: string | null; status: string; observacao?: string | null }>) {
    return authenticatedApi.request<AttendanceResponse>({
      method: 'PUT',
      path: `/api/mobile/aulas/frequencia/${encodeURIComponent(eventId)}`,
      body: { items },
    });
  },
};
