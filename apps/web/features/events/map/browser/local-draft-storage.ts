import {
  getEventMapLocalDraftKey,
  parseEventMapLocalDraft,
  serializeEventMapLocalDraft,
  type EventMapDraftPayload,
} from '@alusa/domain';

export function readEventMapLocalDraft(eventId: string, mapId: string) {
  if (typeof window === 'undefined') return null;

  try {
    return parseEventMapLocalDraft(window.localStorage.getItem(getEventMapLocalDraftKey(eventId, mapId)));
  } catch {
    return null;
  }
}

export function writeEventMapLocalDraft(eventId: string, mapId: string, payload: EventMapDraftPayload) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    getEventMapLocalDraftKey(eventId, mapId),
    serializeEventMapLocalDraft(payload, new Date().toISOString()),
  );
}

export function clearEventMapLocalDraft(eventId: string, mapId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(getEventMapLocalDraftKey(eventId, mapId));
}
