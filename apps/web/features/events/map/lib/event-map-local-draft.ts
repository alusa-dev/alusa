import type { EventMapDTO, EventMapDraftPayload } from '../api/event-map-service';

const DRAFT_VERSION = 1;

type LocalDraftEnvelope = {
  version: number;
  savedAt: string;
  payload: EventMapDraftPayload;
};

export function getEventMapLocalDraftKey(eventId: string, mapId: string) {
  return `alusa.event-map-draft.${eventId}.${mapId}`;
}

export function readEventMapLocalDraft(eventId: string, mapId: string) {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getEventMapLocalDraftKey(eventId, mapId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraftEnvelope>;
    if (parsed.version !== DRAFT_VERSION || !parsed.payload) return null;
    return parsed as LocalDraftEnvelope;
  } catch {
    return null;
  }
}

export function writeEventMapLocalDraft(eventId: string, mapId: string, payload: EventMapDraftPayload) {
  if (typeof window === 'undefined') return;

  const envelope: LocalDraftEnvelope = {
    version: DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    payload,
  };
  window.localStorage.setItem(getEventMapLocalDraftKey(eventId, mapId), JSON.stringify(envelope));
}

export function clearEventMapLocalDraft(eventId: string, mapId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(getEventMapLocalDraftKey(eventId, mapId));
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
