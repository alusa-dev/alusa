import type { EventMapDTO, EventMapDraftPayload } from '../types/event-map-types.js';

const DRAFT_VERSION = 1;

export type LocalDraftEnvelope = {
  version: number;
  savedAt: string;
  payload: EventMapDraftPayload;
};

export function getEventMapLocalDraftKey(eventId: string, mapId: string) {
  return `alusa.event-map-draft.${eventId}.${mapId}`;
}

export function parseEventMapLocalDraft(raw: string | null) {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraftEnvelope>;
    if (parsed.version !== DRAFT_VERSION || !parsed.payload) return null;
    return parsed as LocalDraftEnvelope;
  } catch {
    return null;
  }
}

export function createEventMapLocalDraftEnvelope(payload: EventMapDraftPayload, savedAt: string): LocalDraftEnvelope {
  return {
    version: DRAFT_VERSION,
    savedAt,
    payload,
  };
}

export function serializeEventMapLocalDraft(payload: EventMapDraftPayload, savedAt: string) {
  return JSON.stringify(createEventMapLocalDraftEnvelope(payload, savedAt));
}

export function mergeEventMapWithLocalDraft(map: EventMapDTO, payload: EventMapDraftPayload): EventMapDTO {
  return {
    ...map,
    name: payload.name ?? map.name,
    levels: payload.levels,
    sections: payload.sections.map((section) => ({
      ...section,
      lot: map.sections.find((entry) => entry.id === section.id)?.lot ?? null,
    })),
    objects: payload.objects,
    seatGroups: payload.seatGroups ?? [],
    seats: payload.seats,
    counts: {
      levels: payload.levels.length,
      sections: payload.sections.length,
      seats: payload.seats.length,
      availableSeats: payload.seats.filter((seat) => seat.status === 'AVAILABLE' && seat.publicVisible).length,
    },
  };
}
