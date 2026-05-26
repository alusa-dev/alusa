import { describe, expect, it } from 'vitest';

import { buildLevelRenderStack, type EventMapDTO, type EventMapObjectDTO, type EventSeatDTO, type EventSeatGroupDTO } from '../index';

function object(overrides: Partial<EventMapObjectDTO>): EventMapObjectDTO {
  return {
    id: 'object',
    levelId: 'level-1',
    sectionId: null,
    type: 'GENERAL_AREA',
    data: {},
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
    ...overrides,
  };
}

function seat(overrides: Partial<EventSeatDTO>): EventSeatDTO {
  return {
    id: 'seat',
    levelId: 'level-1',
    sectionId: 'section-1',
    objectId: null,
    groupId: null,
    rowIndex: 0,
    columnIndex: 0,
    technicalCode: 'A-1',
    displayLabel: '1',
    rowLabel: 'A',
    seatNumber: '1',
    status: 'AVAILABLE',
    accessible: false,
    publicVisible: true,
    x: 0,
    y: 0,
    size: 24,
    rotation: 0,
    ...overrides,
  };
}

function seatGroup(overrides: Partial<EventSeatGroupDTO>): EventSeatGroupDTO {
  return {
    id: 'group-1',
    levelId: 'level-1',
    name: 'Grupo',
    x: 0,
    y: 0,
    rotation: 0,
    rows: 1,
    columns: 1,
    seatWidth: 24,
    seatHeight: 24,
    gapX: 8,
    gapY: 8,
    paddingTop: 8,
    paddingRight: 8,
    paddingBottom: 8,
    paddingLeft: 8,
    numbering: {},
    locked: false,
    ...overrides,
  };
}

function map(overrides: Partial<EventMapDTO>): EventMapDTO {
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
    levels: [{ id: 'level-1', name: 'Nivel', sortOrder: 0, widthPx: 1000, heightPx: 800, unit: 'px', scale: null }],
    sections: [],
    objects: [],
    seatGroups: [],
    seats: [],
    versions: [],
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
    ...overrides,
  };
}

describe('buildLevelRenderStack', () => {
  it('renders larger sortOrder later so it appears above on canvas', () => {
    const stack = buildLevelRenderStack(
      map({
        objects: [
          object({ id: 'bottom', sortOrder: 1 }),
          object({ id: 'top', sortOrder: 7 }),
        ],
      }),
      'level-1',
    );

    expect(stack.map((item) => `${item.kind}:${item.id}`)).toEqual(['object:bottom', 'object:top']);
  });

  it('orders seat groups by their linked SECTION object sortOrder', () => {
    const stack = buildLevelRenderStack(
      map({
        objects: [
          object({ id: 'shape', sortOrder: 3 }),
          object({ id: 'section-object', type: 'SECTION', sectionId: 'section-1', sortOrder: 8 }),
        ],
        seatGroups: [seatGroup({ id: 'group-1' })],
        seats: [seat({ id: 'seat-1', groupId: 'group-1', sectionId: 'section-1' })],
      }),
      'level-1',
    );

    expect(stack.map((item) => `${item.kind}:${item.id}`)).toEqual(['object:shape', 'seatGroup:group-1']);
  });

  it('places corridor union at the highest member sortOrder and keeps member hit nodes', () => {
    const stack = buildLevelRenderStack(
      map({
        objects: [
          object({ id: 'corridor-a', type: 'CORRIDOR', x: 0, y: 0, width: 40, height: 100, sortOrder: 2 }),
          object({ id: 'corridor-b', type: 'CORRIDOR', x: 0, y: 80, width: 40, height: 100, sortOrder: 5 }),
        ],
      }),
      'level-1',
    );

    expect(stack.map((item) => item.kind)).toEqual(['object', 'corridorUnion', 'object']);
    expect(stack[1]).toMatchObject({ kind: 'corridorUnion', sortOrder: 5 });
  });
});
