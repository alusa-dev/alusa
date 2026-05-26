import { describe, expect, it } from 'vitest';

import { executeMapCommand, type EventMapDTO, type EventSeatDTO, type EventSeatGroupDTO, type MapCommand } from '../index';

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

function createSeatGroupMap(): EventMapDTO {
  const base = createMap();
  const seatGroup: EventSeatGroupDTO = {
    id: 'group-1',
    levelId: 'level-1',
    name: 'Setor A',
    x: 100,
    y: 80,
    rotation: 0,
    rows: 2,
    columns: 2,
    seatWidth: 20,
    seatHeight: 20,
    gapX: 10,
    gapY: 12,
    paddingTop: 4,
    paddingRight: 4,
    paddingBottom: 4,
    paddingLeft: 4,
    numbering: { rowPrefix: 'A', startNumber: 1, direction: 'left-to-right' },
    locked: false,
  };
  const seats: EventSeatDTO[] = [
    {
      id: 'seat-1',
      levelId: 'level-1',
      sectionId: 'section-1',
      objectId: null,
      groupId: 'group-1',
      rowIndex: 0,
      columnIndex: 0,
      technicalCode: 'SETOR-A-A1',
      displayLabel: 'A1',
      rowLabel: 'A',
      seatNumber: '1',
      status: 'AVAILABLE',
      accessible: false,
      publicVisible: true,
      x: 114,
      y: 94,
      size: 20,
      rotation: 0,
    },
    {
      id: 'seat-2',
      levelId: 'level-1',
      sectionId: 'section-1',
      objectId: null,
      groupId: 'group-1',
      rowIndex: 0,
      columnIndex: 1,
      technicalCode: 'SETOR-A-A2',
      displayLabel: 'A2',
      rowLabel: 'A',
      seatNumber: '2',
      status: 'AVAILABLE',
      accessible: false,
      publicVisible: true,
      x: 144,
      y: 94,
      size: 20,
      rotation: 0,
    },
  ];

  return {
    ...base,
    sections: [
      {
        id: 'section-1',
        levelId: 'level-1',
        lotId: null,
        lot: null,
        name: 'Setor A',
        color: '#6d28d9',
        capacity: null,
        status: 'ACTIVE',
        notes: null,
      },
    ],
    seatGroups: [seatGroup],
    seats,
    counts: { ...base.counts, sections: 1, seats: seats.length, availableSeats: seats.length },
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

  it('updates a seat group and its seats through the canonical UPDATE_ITEMS command', () => {
    const result = executeMapCommand(createSeatGroupMap(), {
      type: 'UPDATE_ITEMS',
      payload: {
        seatGroups: [{ id: 'group-1', patch: { x: 130, y: 110, rotation: 37 } }],
      },
    }, {
      activeLevelId: 'level-1',
      selection: [{ type: 'seatgroup', id: 'group-1' }],
    });

    const group = result.map.seatGroups[0]!;
    const seat = result.map.seats.find((entry) => entry.id === 'seat-1')!;

    expect(group).toMatchObject({ x: 130, y: 110, rotation: 37 });
    expect(seat.x).toBeCloseTo(132.76, 2);
    expect(seat.y).toBeCloseTo(129.61, 2);
    expect(seat.rotation).toBeCloseTo(37, 4);
    expect(result.inversePatches[0]).toMatchObject({
      type: 'UPDATE_ITEMS',
      payload: {
        seatGroups: [{ id: 'group-1', patch: { x: 100, y: 80, rotation: 0 } }],
      },
    });
  });

  it('preserves labels and technical codes when a seat group layout is resized', () => {
    const result = executeMapCommand(createSeatGroupMap(), {
      type: 'UPDATE_SEAT_GROUP',
      payload: {
        id: 'group-1',
        patch: { seatWidth: 24, seatHeight: 24, gapX: 16 },
      },
    }, {
      activeLevelId: 'level-1',
      selection: [{ type: 'seatgroup', id: 'group-1' }],
    });

    expect(result.map.seatGroups[0]).toMatchObject({ seatWidth: 24, seatHeight: 24, gapX: 16 });
    expect(result.map.seats.map((seat) => seat.displayLabel)).toEqual(['A1', 'A2']);
    expect(result.map.seats.map((seat) => seat.technicalCode)).toEqual(['SETOR-A-A1', 'SETOR-A-A2']);
    expect(result.map.seats[0]).toMatchObject({ x: 116, y: 96, size: 24 });
    expect(result.map.seats[1]).toMatchObject({ x: 156, y: 96, size: 24 });
  });

  it('persists free corridor rotation without snapping to quarter turns', () => {
    const map = createMap();
    map.objects[0] = {
      ...map.objects[0]!,
      type: 'CORRIDOR',
      width: 32,
      height: 180,
      data: { smartCorridor: true, corridorAxis: 'vertical' },
    };

    const result = executeMapCommand(map, {
      type: 'UPDATE_OBJECT',
      payload: { id: 'object-1', patch: { rotation: 37 } },
    }, {
      activeLevelId: 'level-1',
      selection: [{ type: 'object', id: 'object-1' }],
    });

    expect(result.map.objects[0]?.rotation).toBe(37);
    expect(result.inversePatches[0]).toMatchObject({
      type: 'UPDATE_ITEMS',
      payload: { objects: [{ id: 'object-1', patch: { rotation: 0 } }] },
    });
  });
});
