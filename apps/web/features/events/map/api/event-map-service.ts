'use client';

export type {
  EventMapDTO,
  EventMapDraftPayload,
  EventMapLevelDTO,
  EventMapObjectDTO,
  EventMapSectionDTO,
  EventSeatDTO,
  EventSeatGroupDTO,
} from '@alusa/domain';

import type { EventMapDTO, EventMapDraftPayload } from '@alusa/domain';

type JsonEnvelope<T> = { data: T };

const EVENT_MAP_REQUEST_TIMEOUT_MS = 30000;

async function eventMapFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), EVENT_MAP_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('A requisição demorou demais. Salve o mapa novamente e tente publicar em seguida.');
    }
    throw new Error('Não foi possível conectar ao servidor para salvar o mapa. Verifique sua conexão e tente novamente.');
  } finally {
    window.clearTimeout(timeout);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text().catch(() => '');
  const json = rawText
    ? (() => {
        try {
          return JSON.parse(rawText) as unknown;
        } catch {
          return null;
        }
      })()
    : null;

  if (!response.ok) {
    const payload = json as
      | {
          error?: { message?: string; code?: string } | string;
          message?: string;
          details?: unknown;
        }
      | null;
    const errorMessage = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
    const message =
      errorMessage ??
      payload?.message ??
      (rawText && rawText.length < 400 ? rawText : null) ??
      `Não foi possível concluir a ação do mapa. Código HTTP ${response.status}.`;
    throw new Error(message);
  }

  return json as T;
}

export async function listEventMaps(eventId: string) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO[]>>(
    await eventMapFetch(`/api/events/${eventId}/maps`, { cache: 'no-store' }),
  );
  return json.data;
}

export async function getEventMap(eventId: string, mapId: string) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await eventMapFetch(`/api/events/${eventId}/maps/${mapId}`, { cache: 'no-store' }),
  );
  return json.data;
}

export async function createEventMap(eventId: string, payload: { name: string }) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await eventMapFetch(`/api/events/${eventId}/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
  return json.data;
}

export async function saveEventMapDraft(eventId: string, mapId: string, payload: EventMapDraftPayload) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await eventMapFetch(`/api/events/${eventId}/maps/${mapId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
  return json.data;
}

export async function publishEventMap(eventId: string, mapId: string, payload?: EventMapDraftPayload | null) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await eventMapFetch(`/api/events/${eventId}/maps/${mapId}/publish`, {
      method: 'POST',
      ...(payload
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        : {}),
    }),
  );
  return json.data;
}

export async function duplicateEventMap(eventId: string, mapId: string) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await eventMapFetch(`/api/events/${eventId}/maps/${mapId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );
  return json.data;
}

export async function deleteEventMap(eventId: string, mapId: string) {
  await parseResponse<{ ok: true }>(await eventMapFetch(`/api/events/${eventId}/maps/${mapId}`, { method: 'DELETE' }));
}
