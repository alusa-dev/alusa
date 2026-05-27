import { describe, expect, it } from 'vitest';

import {
  deleteSelection,
  duplicateSelection,
  executeMapCommand,
  getObjectGroupId,
  moveSelection,
  resizeSelection,
  type EventMapDTO,
  type EventMapObjectDTO,
  type EventSeatDTO,
  type EventSeatGroupDTO,
  type MapCommand,
  type MapEngineRuntime,
} from '../index.js';

function baseMap(overrides: Partial<EventMapDTO> = {}): EventMapDTO {
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Evento', startsAt: new Date(0).toISOString(), status: 'DRAFT', ticketMode: 'NUMBERED_SEATS' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1440, heightPx: 900, unit: 'px', scale: null }],
    sections: [],
    objects: [],
    seatGroups: [],
    seats: [],
    versions: [],
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
    ...overrides,
  };
}

function object(id: string, patch: Partial<EventMapObjectDTO> = {}): EventMapObjectDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: null,
    type: 'GENERAL_AREA',
    data: {},
    x: 100,
    y: 100,
    width: 50,
    height: 50,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
    ...patch,
  };
}

function sectionObject(id = 'section-object', sectionId = 'section-1', patch: Partial<EventMapObjectDTO> = {}) {
  return object(id, {
    type: 'SECTION',
    sectionId,
    data: { label: 'Setor 1', fill: '#6d28d9' },
    width: 160,
    height: 120,
    ...patch,
  });
}

function seat(id: string, patch: Partial<EventSeatDTO> = {}): EventSeatDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: 'section-1',
    objectId: null,
    groupId: null,
    rowIndex: null,
    columnIndex: null,
    technicalCode: id.toUpperCase(),
    displayLabel: id,
    rowLabel: null,
    seatNumber: null,
    status: 'AVAILABLE',
    accessible: false,
    publicVisible: true,
    x: 120,
    y: 120,
    size: 20,
    rotation: 0,
    ...patch,
  };
}

function seatGroup(id = 'seatgroup-1', patch: Partial<EventSeatGroupDTO> = {}): EventSeatGroupDTO {
  return {
    id,
    levelId: 'level-1',
    name: 'Setor 1',
    x: 110,
    y: 110,
    rotation: 0,
    rows: 1,
    columns: 2,
    seatWidth: 20,
    seatHeight: 20,
    gapX: 10,
    gapY: 10,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    numbering: { rowPrefix: 'A', startNumber: 1, direction: 'left-to-right' },
    locked: false,
    ...patch,
  };
}

function sectionMap() {
  const group = seatGroup();
  const seats = [
    seat('seat-1', { groupId: group.id, rowIndex: 0, columnIndex: 0, x: 120, y: 120 }),
    seat('seat-2', { groupId: group.id, rowIndex: 0, columnIndex: 1, x: 150, y: 120 }),
    seat('seat-3', { groupId: null, x: 180, y: 150 }),
  ];

  return baseMap({
    sections: [{ id: 'section-1', levelId: 'level-1', lotId: null, lot: null, name: 'Setor 1', color: '#6d28d9', capacity: null, status: 'ACTIVE', notes: null }],
    objects: [sectionObject()],
    seatGroups: [group],
    seats,
    counts: { levels: 1, sections: 1, seats: seats.length, availableSeats: seats.length },
  });
}

function deterministicRuntime(): MapEngineRuntime {
  let sequence = 0;
  return {
    createId(prefix) {
      sequence += 1;
      return `${prefix}-copy-${sequence}`;
    },
  };
}

describe('selection actions', () => {
  it('moves a section, its loose seats and grouped seats through their seat group', () => {
    const map = sectionMap();

    const result = executeMapCommand(map, {
      type: 'MOVE_SELECTION',
      payload: { selection: [{ type: 'section', id: 'section-1' }], delta: { x: 10, y: 5 } },
    }, {
      activeLevelId: 'level-1',
      selection: [{ type: 'section', id: 'section-1' }],
    });

    expect(result.map.objects.find((entry) => entry.id === 'section-object')).toMatchObject({ x: 110, y: 105 });
    expect(result.map.seatGroups[0]).toMatchObject({ x: 120, y: 115 });
    expect(result.map.seats.find((entry) => entry.id === 'seat-1')).toMatchObject({ x: 130, y: 125 });
    expect(result.map.seats.find((entry) => entry.id === 'seat-3')).toMatchObject({ x: 190, y: 155 });
    expect(result.undoCommand).toMatchObject({ type: 'UPDATE_ITEMS' });
  });

  it('promotes a grouped seat move to the seat group source of truth', () => {
    const map = sectionMap();

    const result = moveSelection({
      map,
      selection: [{ type: 'seat', id: 'seat-1' }],
      delta: { x: 8, y: -4 },
    });

    expect(result.patches.seats).toHaveLength(0);
    expect(result.patches.seatGroups).toEqual([{ id: 'seatgroup-1', patch: { x: 118, y: 106 } }]);
  });

  it('scales multiple objects around a shared pivot', () => {
    const left = object('left', { x: 100, y: 100, width: 50, height: 50 });
    const right = object('right', { x: 200, y: 100, width: 50, height: 50 });
    const map = baseMap({ objects: [left, right] });

    const result = resizeSelection({
      map,
      selection: [{ type: 'object', id: 'left' }, { type: 'object', id: 'right' }],
      scaleX: 2,
      scaleY: 1,
    });

    expect(result.patches.objects.find((entry) => entry.id === 'left')?.patch).toMatchObject({ x: 25, y: 100, width: 100, height: 50 });
    expect(result.patches.objects.find((entry) => entry.id === 'right')?.patch).toMatchObject({ x: 225, y: 100, width: 100, height: 50 });
    expect(result.undoPatches.objects).toHaveLength(2);
  });

  it('filters explicit resize patches that would desync grouped seats', () => {
    const map = sectionMap();

    const result = resizeSelection({
      map,
      selection: [{ type: 'seat', id: 'seat-1' }],
      patches: {
        seats: [{ id: 'seat-1', patch: { x: 300, y: 300, size: 40 } }],
        seatGroups: [{ id: 'seatgroup-1', patch: { seatWidth: 24, seatHeight: 24 } }],
      },
    });

    expect(result.patches.seats).toHaveLength(0);
    expect(result.patches.seatGroups).toEqual([{ id: 'seatgroup-1', patch: { seatWidth: 24, seatHeight: 24 } }]);
  });

  it('drops invalid resize patches before they reach the document', () => {
    const map = baseMap({ objects: [object('object-1')] });

    const result = executeMapCommand(map, {
      type: 'RESIZE_OBJECTS',
      payload: { objects: [{ id: 'object-1', patch: { x: Number.NaN } }] },
    }, {
      activeLevelId: 'level-1',
      selection: [{ type: 'object', id: 'object-1' }],
    });

    expect(result.map.objects[0]?.x).toBe(100);
    expect(result.patches).toEqual([]);
  });

  it('duplicates a grouped seat by duplicating the whole seat group', () => {
    const result = duplicateSelection({
      map: sectionMap(),
      selection: [{ type: 'seat', id: 'seat-1' }],
      runtime: deterministicRuntime(),
    });

    expect(result.map.seatGroups).toHaveLength(2);
    expect(result.map.seats.filter((entry) => entry.groupId === 'seatgroup-copy-1')).toHaveLength(2);
    expect(result.selection).toContainEqual({ type: 'seatgroup', id: 'seatgroup-copy-1' });
  });

  it('duplicates a full section and undo removes every created section, group, object and seat', () => {
    const duplicated = executeMapCommand(sectionMap(), {
      type: 'DUPLICATE_SELECTION',
      payload: { selection: [{ type: 'section', id: 'section-1' }] },
    }, {
      activeLevelId: 'level-1',
      selection: [{ type: 'section', id: 'section-1' }],
      runtime: deterministicRuntime(),
    });

    expect(duplicated.map.sections).toHaveLength(2);
    expect(duplicated.map.seatGroups).toHaveLength(2);
    expect(duplicated.map.seats).toHaveLength(6);

    const undone = executeMapCommand(duplicated.map, duplicated.undoCommand as MapCommand, {
      activeLevelId: 'level-1',
      selection: duplicated.selection,
    });

    expect(undone.map.sections).toHaveLength(1);
    expect(undone.map.seatGroups).toHaveLength(1);
    expect(undone.map.objects).toHaveLength(1);
    expect(undone.map.seats).toHaveLength(3);
  });

  it('blocks destructive deletion of locked objects or sold seats', () => {
    const locked = deleteSelection({
      map: baseMap({ objects: [object('locked', { locked: true })] }),
      selection: [{ type: 'object', id: 'locked' }],
    });

    const sold = deleteSelection({
      map: baseMap({ seats: [seat('sold', { status: 'SOLD' })] }),
      selection: [{ type: 'seat', id: 'sold' }],
    });

    expect(locked.blocked).toBe(true);
    expect(locked.map.objects).toHaveLength(1);
    expect(sold.blocked).toBe(true);
    expect(sold.map.seats).toHaveLength(1);
  });

  it('restores every changed group member when undoing ungroup from one selected member', () => {
    const map = baseMap({
      objects: [
        object('a', { data: { groupId: 'group-1', groupLabel: 'Grupo 01' } }),
        object('b', { data: { groupId: 'group-1', groupLabel: 'Grupo 01' }, x: 200 }),
      ],
    });

    const ungrouped = executeMapCommand(map, {
      type: 'UNGROUP_SELECTION',
      payload: { selection: [{ type: 'object', id: 'a' }] },
    }, {
      activeLevelId: 'level-1',
      selection: [{ type: 'object', id: 'a' }],
    });

    expect(ungrouped.map.objects.map(getObjectGroupId)).toEqual([null, null]);

    const restored = executeMapCommand(ungrouped.map, ungrouped.undoCommand as MapCommand, {
      activeLevelId: 'level-1',
      selection: ungrouped.selection,
    });

    expect(restored.map.objects.map(getObjectGroupId)).toEqual(['group-1', 'group-1']);
  });
});
