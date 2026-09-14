import { authenticatedApi } from '@/features/auth/services/auth-service';

import type {
  EventDetailResponse,
  EventFinancialEntriesResponse,
  EventFinancialEntryResponse,
  EventParticipantsResponse,
  EventListResponse,
  MobileCostumeResourcesResponse,
  EventStatus,
  EventType,
  TicketCheckInResponse,
  TicketVerificationResponse,
} from '../types/events';

function queryString(input: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const eventsService = {
  listEvents(input: { pageSize?: number; search?: string; status?: EventStatus; type?: EventType; hasTickets?: boolean; signal?: AbortSignal } = {}) {
    return authenticatedApi.request<EventListResponse>({
      method: 'GET',
      path: `/api/mobile/events${queryString({ pageSize: input.pageSize, search: input.search, status: input.status, type: input.type, hasTickets: input.hasTickets })}`,
      signal: input.signal,
    });
  },

  getEvent(eventId: string) {
    return authenticatedApi.request<EventDetailResponse>({
      method: 'GET',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}`,
    });
  },

  listFinancialEntries(eventId: string, input: {
    page?: number;
    pageSize?: number;
    search?: string;
    type?: 'COST' | 'REVENUE';
    status?: 'EXPECTED' | 'PENDING' | 'PAID' | 'RECEIVED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  } = {}) {
    return authenticatedApi.request<EventFinancialEntriesResponse>({
      method: 'GET',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/financial${queryString(input)}`,
    });
  },

  listEventParticipants(eventId: string, input: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: 'ACTIVE' | 'CANCELLED';
  } = {}) {
    return authenticatedApi.request<EventParticipantsResponse>({
      method: 'GET',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/participants${queryString(input)}`,
    });
  },

  createFinancialEntry(eventId: string, input: Record<string, unknown>) {
    return authenticatedApi.request<EventFinancialEntryResponse>({
      method: 'POST',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/financial`,
      body: input,
    });
  },

  updateFinancialEntry(eventId: string, entryId: string, input: Record<string, unknown>) {
    return authenticatedApi.request<EventFinancialEntryResponse>({
      method: 'PATCH',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/financial/${encodeURIComponent(entryId)}`,
      body: input,
    });
  },

  getCostumeResources(eventId: string) {
    return authenticatedApi.request<MobileCostumeResourcesResponse>({
      method: 'GET',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/costumes`,
    });
  },

  createCostumeAssignment(eventId: string, input: Record<string, unknown>) {
    return authenticatedApi.request<{ assignment: unknown }>({
      method: 'POST',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/costumes/assignments`,
      body: input,
    });
  },

  finishEvent(eventId: string) {
    return authenticatedApi.request<EventDetailResponse>({
      method: 'POST',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/status`,
      body: { status: 'FINISHED' },
    });
  },

  reactivateEvent(eventId: string) {
    return authenticatedApi.request<EventDetailResponse>({
      method: 'POST',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/status`,
      body: { status: 'ACTIVE' },
    });
  },

  verifyTicket(ticketCode: string, confirm = false) {
    return authenticatedApi.request<TicketVerificationResponse | TicketCheckInResponse, { ticketCode: string; confirm: boolean }>({
      method: 'POST',
      path: '/api/mobile/tickets/verify',
      body: { ticketCode, confirm },
    });
  },

  verifyTicketForEvent(eventId: string, ticketCode: string, confirm = false) {
    return authenticatedApi.request<TicketVerificationResponse | TicketCheckInResponse, { ticketCode: string; confirm: boolean }>({
      method: 'POST',
      path: `/api/mobile/events/${encodeURIComponent(eventId)}/tickets/verify`,
      body: { ticketCode, confirm },
    });
  },
};
