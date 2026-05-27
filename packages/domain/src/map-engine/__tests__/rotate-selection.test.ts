import { describe, expect, it } from 'vitest';

import {
  executeMapCommand,
  getCorridorWorldCenter,
  rotateSelection,
  type EventMapDTO,
  type EventMapObjectDTO,
  type EventSeatDTO,
  type EventSeatGroupDTO,
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

function shape(id: string, patch: Partial<EventMapObjectDTO> = {}): EventMapObjectDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: null,
    type: 'GENERAL_AREA',
    data: {},
    x: 100,
    y: 100,
    width: 100,
    height: 50,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
    ...patch,
  };
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
    technicalCode: id,
    displayLabel: id,
    rowLabel: null,
    seatNumber: null,
    status: 'AVAILABLE',
    accessible: false,
    publicVisible: true,
    x: 100,
    y: 100,
    size: 24,
    rotation: 0,
    ...patch,
  };
}

function seatGroup(id: string, patch: Partial<EventSeatGroupDTO> = {}): EventSeatGroupDTO {
  return {
    id,
    levelId: 'level-1',
    name: 'Grupo',
    x: 200,
    y: 200,
    rotation: 0,
    rows: 2,
    columns: 2,
    seatWidth: 20,
    seatHeight: 20,
    gapX: 4,
    gapY: 4,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    numbering: {},
    locked: false,
    ...patch,
  };
}

describe('rotateSelection', () => {
  it('rotates a single object around its visual center', () => {
    const object = shape('obj-1', { x: 100, y: 100, width: 100, height: 50 });
    const map = baseMap({ objects: [object] });

    const result = rotateSelection({
      map,
      selection: [{ type: 'object', id: object.id }],
      angleDelta: 90,
    });

    expect(result.patches.objects).toHaveLength(1);
    expect(result.patches.objects[0]?.patch).toMatchObject({ x: 175, y: 75, rotation: 90 });
    expect(result.undoPatches.objects[0]?.patch).toMatchObject({ x: 100, y: 100, rotation: 0 });
  });

  it('rotates multiple objects around the shared selection pivot', () => {
    const left = shape('left', { x: 100, y: 100, width: 40, height: 40 });
    const right = shape('right', { x: 220, y: 100, width: 40, height: 40 });
    const map = baseMap({ objects: [left, right] });

    const result = rotateSelection({
      map,
      selection: [
        { type: 'object', id: left.id },
        { type: 'object', id: right.id },
      ],
      angleDelta: 90,
    });

    expect(result.pivot).toEqual({ x: 180, y: 120 });
    expect(result.patches.objects.find((entry) => entry.id === 'left')?.patch).toMatchObject({
      x: 200,
      y: 40,
      rotation: 90,
    });
    expect(result.patches.objects.find((entry) => entry.id === 'right')?.patch).toMatchObject({
      x: 200,
      y: 160,
      rotation: 90,
    });
  });

  it('rotates text without changing text data or dimensions', () => {
    const text = shape('text-1', {
      type: 'TEXT',
      data: { text: 'Alusa', fontSize: 24 },
      width: null,
      height: null,
    });
    const map = baseMap({ objects: [text] });

    const result = rotateSelection({ map, selection: [{ type: 'object', id: text.id }], angleDelta: 45 });

    expect(result.patches.objects[0]?.patch.rotation).toBe(45);
    expect(result.patches.objects[0]?.patch.data).toBeUndefined();
    expect(result.patches.objects[0]?.patch.width).toBeUndefined();
    expect(result.patches.objects[0]?.patch.height).toBeUndefined();
  });

  it('rotates a section and its loose seats once', () => {
    const sectionObject = shape('section-object', {
      type: 'SECTION',
      sectionId: 'section-1',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
    const looseSeat = seat('seat-1', { x: 150, y: 150, sectionId: 'section-1' });
    const map = baseMap({
      sections: [{ id: 'section-1', levelId: 'level-1', lotId: null, lot: null, name: 'Setor 1', color: '#fff', capacity: null, status: 'ACTIVE', notes: null }],
      objects: [sectionObject],
      seats: [looseSeat],
    });

    const result = rotateSelection({
      map,
      selection: [
        { type: 'section', id: 'section-1' },
        { type: 'seat', id: 'seat-1' },
      ],
      angleDelta: 90,
    });

    expect(result.patches.objects).toHaveLength(1);
    expect(result.patches.seats).toHaveLength(1);
    expect(result.patches.seats[0]?.id).toBe('seat-1');
  });

  it('rotates a seat group as the source of truth instead of patching each grouped seat', () => {
    const group = seatGroup('group-1');
    const groupedSeat = seat('seat-1', { groupId: group.id, x: 210, y: 210 });
    const map = baseMap({ seatGroups: [group], seats: [groupedSeat] });

    const result = rotateSelection({
      map,
      selection: [
        { type: 'seatgroup', id: group.id },
        { type: 'seat', id: groupedSeat.id },
      ],
      angleDelta: 45,
    });

    expect(result.patches.seatGroups).toHaveLength(1);
    expect(result.patches.seats).toHaveLength(0);
    expect(result.patches.seatGroups[0]?.patch.rotation).toBe(45);
  });

  it('preserves a corridor center when rotating it alone', () => {
    const corridor = shape('corridor-1', {
      type: 'CORRIDOR',
      x: 100,
      y: 120,
      width: 300,
      height: 40,
      rotation: 0,
      data: {},
    });
    const map = baseMap({ objects: [corridor] });
    const beforeCenter = getCorridorWorldCenter(corridor);

    const result = rotateSelection({ map, selection: [{ type: 'object', id: corridor.id }], angleDelta: 90 });
    const patch = result.patches.objects[0]?.patch;
    const afterCenter = getCorridorWorldCenter({ ...corridor, ...patch });

    expect(afterCenter.x).toBeCloseTo(beforeCenter.x, 4);
    expect(afterCenter.y).toBeCloseTo(beforeCenter.y, 4);
    expect(patch?.rotation).toBe(90);
  });

  it('blocks rotation when selection contains a sold seat', () => {
    const soldSeat = seat('seat-1', { status: 'SOLD' });
    const map = baseMap({ seats: [soldSeat] });

    const result = rotateSelection({ map, selection: [{ type: 'seat', id: soldSeat.id }], angleDelta: 90 });

    expect(result.patches.seats).toHaveLength(0);
    expect(result.warnings).toContain('A seleção contém assento vendido.');
  });

  it('undoes and redoes rotation as one command through the reducer', () => {
    const object = shape('obj-1', { x: 100, y: 100, width: 100, height: 50 });
    const map = baseMap({ objects: [object] });

    const rotated = executeMapCommand(map, {
      type: 'ROTATE_SELECTION',
      payload: { selection: [{ type: 'object', id: object.id }], angleDelta: 90 },
    }, { selection: [{ type: 'object', id: object.id }], activeLevelId: 'level-1' });

    expect(rotated.map.objects[0]).toMatchObject({ x: 175, y: 75, rotation: 90 });
    expect(rotated.undoCommand).toBeTruthy();

    const restored = executeMapCommand(rotated.map, rotated.undoCommand!, {
      selection: [{ type: 'object', id: object.id }],
      activeLevelId: 'level-1',
    });

    expect(restored.map.objects[0]).toMatchObject({ x: 100, y: 100, rotation: 0 });
  });
});
