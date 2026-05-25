import { describe, expect, it } from 'vitest';

import { executeMapCommand, type EventMapDTO, type MapCommand } from '../index';

function createMap(): EventMapDTO {
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Evento', startsAt: '2026-01-01T00:00:00.000Z', status: 'ACTIVE', ticketMode: 'NUMBERED_SEATS' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Plateia', sortOrder: 0, widthPx: 1000, heightPx: 800, unit: 'px', scale: null }],
    sections: [],
    objects: [
      {
        id: 'object-1',
        levelId: 'level-1',
        sectionId: null,
        type: 'GENERAL_AREA',
        data: { label: 'Area' },
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: 0,
      },
    ],
    seatGroups: [],
    seats: [],
    versions: [],
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
  };
}

describe('map command reducer', () => {
  it('accepts the context object signature and exposes patch metadata', () => {
    const command: MapCommand = {
      type: 'UPDATE_OBJECT',
      payload: { id: 'object-1', patch: { x: 42 } },
    };

    const result = executeMapCommand(createMap(), command, {
      activeLevelId: 'level-1',
      selection: [],
    });

    expect(result.map.objects[0]?.x).toBe(42);
    expect(result.document).toBe(result.map);
    expect(result.patches[0]?.type).toBe('UPDATE_ITEMS');
    expect(result.inversePatches[0]?.type).toBe('UPDATE_ITEMS');
    expect(result.warnings).toEqual([]);
  });

  it('normalizes move and text commands to canonical item updates', () => {
    const moved = executeMapCommand(createMap(), {
      type: 'MOVE_OBJECTS',
      payload: { objectIds: ['object-1'], delta: { x: 5, y: -2 } },
    }, {
      activeLevelId: 'level-1',
      selection: [],
    });

    expect(moved.map.objects[0]).toMatchObject({ x: 15, y: 18 });

    const textMap = {
      ...createMap(),
      objects: [
        {
          ...createMap().objects[0]!,
          type: 'TEXT' as const,
          width: null,
          height: null,
          data: { textMode: 'auto', fontSize: 22 },
        },
      ],
    };
    const updatedText = executeMapCommand(textMap, {
      type: 'UPDATE_TEXT',
      payload: { id: 'object-1', text: 'Novo texto' },
    }, {
      activeLevelId: 'level-1',
      selection: [],
    });

    expect(updatedText.map.objects[0]?.data).toMatchObject({
      text: 'Novo texto',
      label: 'Novo texto',
      textMode: 'auto',
    });
  });
});
