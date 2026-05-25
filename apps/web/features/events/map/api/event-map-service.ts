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

async function parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível concluir a ação do mapa.';
    throw new Error(message);
  }

  return json as T;
}

export async function listEventMaps(eventId: string) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO[]>>(
    await fetch(`/api/events/${eventId}/maps`, { cache: 'no-store' }),
  );
  return json.data;
}

export async function getEventMap(eventId: string, mapId: string) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await fetch(`/api/events/${eventId}/maps/${mapId}`, { cache: 'no-store' }),
  );
  return json.data;
}

export async function createEventMap(eventId: string, payload: { name: string }) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await fetch(`/api/events/${eventId}/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
  return json.data;
}

export async function saveEventMapDraft(eventId: string, mapId: string, payload: EventMapDraftPayload) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await fetch(`/api/events/${eventId}/maps/${mapId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
  return json.data;
}

export async function publishEventMap(eventId: string, mapId: string) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await fetch(`/api/events/${eventId}/maps/${mapId}/publish`, { method: 'POST' }),
  );
  return json.data;
}

export async function duplicateEventMap(eventId: string, mapId: string) {
  const json = await parseResponse<JsonEnvelope<EventMapDTO>>(
    await fetch(`/api/events/${eventId}/maps/${mapId}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );
  return json.data;
}

export async function deleteEventMap(eventId: string, mapId: string) {
  await parseResponse<{ ok: true }>(await fetch(`/api/events/${eventId}/maps/${mapId}`, { method: 'DELETE' }));
}
