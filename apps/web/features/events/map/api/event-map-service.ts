'use client';

import type {
  EventMapObjectType,
  EventMapStatus,
  EventSeatStatus,
  EventTicketLotStatus,
} from '@alusa/shared';

export type EventMapLevelDTO = {
  id: string;
  name: string;
  sortOrder: number;
  widthPx: number;
  heightPx: number;
  unit: string;
  scale: string | null;
};

export type EventMapSectionDTO = {
  id: string;
  levelId: string;
  lotId: string | null;
  lot: {
    id: string;
    name: string;
    unitPrice: number;
    status: EventTicketLotStatus;
    quantityTotal: number;
    quantitySold: number;
  } | null;
  name: string;
  color: string;
  capacity: number | null;
  status: string;
  notes: string | null;
};

export type EventMapObjectDTO = {
  id: string;
  levelId: string;
  sectionId: string | null;
  type: EventMapObjectType;
  data: Record<string, unknown>;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  locked: boolean;
  hidden: boolean;
  sortOrder: number;
};

export type EventSeatDTO = {
  id: string;
  levelId: string;
  sectionId: string;
  objectId: string | null;
  technicalCode: string;
  displayLabel: string;
  rowLabel: string | null;
  seatNumber: string | null;
  status: EventSeatStatus;
  accessible: boolean;
  publicVisible: boolean;
  x: number;
  y: number;
  size: number | null;
  rotation: number;
};

export type EventMapDTO = {
  id: string;
  contaId: string;
  eventId: string;
  event: { id: string; name: string; startsAt: string; status: string; ticketMode: string };
  name: string;
  status: EventMapStatus;
  publishedVersionId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  levels: EventMapLevelDTO[];
  sections: EventMapSectionDTO[];
  objects: EventMapObjectDTO[];
  seats: EventSeatDTO[];
  versions: Array<{ id: string; version: number; status: EventMapStatus; createdAt: string }>;
  counts: {
    levels: number;
    sections: number;
    seats: number;
    availableSeats: number;
  };
};

export type EventMapDraftPayload = {
  name?: string;
  levels: EventMapLevelDTO[];
  sections: Array<Omit<EventMapSectionDTO, 'lot'>>;
  objects: EventMapObjectDTO[];
  seats: EventSeatDTO[];
};

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
