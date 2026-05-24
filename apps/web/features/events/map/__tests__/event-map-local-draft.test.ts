import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventMapDTO, EventMapDraftPayload } from '../api/event-map-service';
import {
  clearEventMapLocalDraft,
  getEventMapLocalDraftKey,
  mergeEventMapWithLocalDraft,
  readEventMapLocalDraft,
  writeEventMapLocalDraft,
} from '../lib/event-map-local-draft';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function createMap(): EventMapDTO {
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Evento', startsAt: '2026-01-01T00:00:00.000Z', status: 'DRAFT', ticketMode: 'SEATED' },
    name: 'Mapa salvo',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1440, heightPx: 900, unit: 'px', scale: null }],
    sections: [
      {
        id: 'section-1',
        levelId: 'level-1',
        lotId: 'lot-1',
        lot: { id: 'lot-1', name: 'Lote 1', unitPrice: 100, status: 'ACTIVE', quantityTotal: 100, quantitySold: 0 },
        name: 'Setor 1',
        color: '#6d28d9',
        capacity: null,
        status: 'ACTIVE',
        notes: null,
      },
    ],
    objects: [],
    seatGroups: [],
    seats: [],
    versions: [],
    counts: { levels: 1, sections: 1, seats: 0, availableSeats: 0 },
  };
}

function createPayload(): EventMapDraftPayload {
  return {
    name: 'Mapa local',
    levels: [{ id: 'level-1', name: 'Ambiente editado', sortOrder: 0, widthPx: 1440, heightPx: 900, unit: 'px', scale: null }],
    sections: [
      {
        id: 'section-1',
        levelId: 'level-1',
        lotId: 'lot-1',
        name: 'Setor local',
        color: '#10b981',
        capacity: null,
        status: 'ACTIVE',
        notes: null,
      },
    ],
    objects: [
      {
        id: 'object-1',
        levelId: 'level-1',
        sectionId: 'section-1',
        type: 'SECTION',
        data: { label: 'Setor local' },
        x: 120,
        y: 160,
        width: 220,
        height: 140,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: 0,
      },
    ],
    seats: [
      {
        id: 'seat-1',
        levelId: 'level-1',
        sectionId: 'section-1',
        objectId: null,
        groupId: null,
        rowIndex: null,
        columnIndex: null,
        technicalCode: 'A1',
        displayLabel: 'A1',
        rowLabel: 'A',
        seatNumber: '1',
        status: 'AVAILABLE',
        accessible: false,
        publicVisible: true,
        x: 150,
        y: 180,
        size: 24,
        rotation: 0,
      },
    ],
    seatGroups: [],
  };
}

describe('event map local draft', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: createStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists and clears a versioned local draft', () => {
    const payload = createPayload();

    writeEventMapLocalDraft('event-1', 'map-1', payload);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      getEventMapLocalDraftKey('event-1', 'map-1'),
      expect.stringContaining('"version":1'),
    );

    const draft = readEventMapLocalDraft('event-1', 'map-1');
    expect(draft?.payload).toEqual(payload);

    clearEventMapLocalDraft('event-1', 'map-1');
    expect(readEventMapLocalDraft('event-1', 'map-1')).toBeNull();
  });

  it('merges a local draft over server data while preserving lot details', () => {
    const merged = mergeEventMapWithLocalDraft(createMap(), createPayload());

    expect(merged.name).toBe('Mapa local');
    expect(merged.levels[0]?.name).toBe('Ambiente editado');
    expect(merged.sections[0]).toMatchObject({
      name: 'Setor local',
      lot: { id: 'lot-1', name: 'Lote 1' },
    });
    expect(merged.counts).toEqual({ levels: 1, sections: 1, seats: 1, availableSeats: 1 });
  });
});
