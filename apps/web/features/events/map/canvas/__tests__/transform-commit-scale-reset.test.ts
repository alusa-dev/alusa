import { beginMapTransformSession, buildMapTransformCommit } from '../transform/map-transform-session';
import type { EventMapDTO } from '../../api/event-map-service';

import { describe, expect, it } from 'vitest';

function mapWithSeatGroup(): EventMapDTO {
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Evento', startsAt: '2026-01-01T00:00:00.000Z', status: 'DRAFT', ticketMode: 'SEATED' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Main', sortOrder: 0, widthPx: 1000, heightPx: 700, unit: 'px', scale: null }],
    sections: [],
    objects: [],
    seatGroups: [{
      id: 'group-1',
      levelId: 'level-1',
      name: 'Grid',
      x: 100,
      y: 120,
      rotation: 0,
      rows: 2,
      columns: 3,
      seatWidth: 20,
      seatHeight: 18,
      gapX: 8,
      gapY: 10,
      paddingTop: 4,
      paddingRight: 6,
      paddingBottom: 4,
      paddingLeft: 6,
      numbering: {},
      locked: false,
    }],
    seats: [],
    versions: [],
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
  };
}

function mapWithTwoShapes(): EventMapDTO {
  return {
    ...mapWithSeatGroup(),
    seatGroups: [],
    objects: [
      {
        id: 'object-1',
        levelId: 'level-1',
        sectionId: null,
        type: 'GENERAL_AREA',
        data: {},
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: 0,
      },
      {
        id: 'object-2',
        levelId: 'level-1',
        sectionId: null,
        type: 'GENERAL_AREA',
        data: {},
        x: 160,
        y: 20,
        width: 120,
        height: 60,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: 1,
      },
    ],
  };
}

function mockNode() {
  const state = { x: 130, y: 150, rotation: 37, scaleX: 1.5, scaleY: 2 };
  return {
    x: () => state.x,
    y: () => state.y,
    rotation: () => state.rotation,
    scaleX: (value?: number) => {
      if (typeof value === 'number') state.scaleX = value;
      return state.scaleX;
    },
    scaleY: (value?: number) => {
      if (typeof value === 'number') state.scaleY = value;
      return state.scaleY;
    },
  };
}

function mockShapeNode(attrs: { x: number; y: number; rotation?: number; scaleX?: number; scaleY?: number }) {
  const state = {
    x: attrs.x,
    y: attrs.y,
    rotation: attrs.rotation ?? 0,
    scaleX: attrs.scaleX ?? 1,
    scaleY: attrs.scaleY ?? 1,
  };
  return {
    x: () => state.x,
    y: () => state.y,
    rotation: () => state.rotation,
    scaleX: (value?: number) => {
      if (typeof value === 'number') state.scaleX = value;
      return state.scaleX;
    },
    scaleY: (value?: number) => {
      if (typeof value === 'number') state.scaleY = value;
      return state.scaleY;
    },
    setScale: (scaleX: number, scaleY: number) => {
      state.scaleX = scaleX;
      state.scaleY = scaleY;
    },
  };
}

describe('transform commit scale reset', () => {
  it('commits seat group transform and resets residual scale', () => {
    const map = mapWithSeatGroup();
    const node = mockNode();
    const stage = {
      findOne: (selector: string) => (selector === '#node-seatgroup-group-1' ? node : null),
    };
    const transformer = { getActiveAnchor: () => 'bottom-right' };

    const session = beginMapTransformSession({
      kind: 'generic',
      map,
      corridorIds: [],
      selectedObjectIds: [],
      selectedSeatIds: [],
      selectedSeatGroupIds: ['group-1'],
      stage: stage as never,
      transformer: transformer as never,
    });

    expect(session).not.toBeNull();
    const commit = buildMapTransformCommit(session!, { stage: stage as never, transformer: transformer as never }, map);

    expect(commit.seatGroupUpdates).toEqual([
      {
        id: 'group-1',
        patch: expect.objectContaining({
          x: 130,
          y: 150,
          rotation: 37,
          seatWidth: 30,
          seatHeight: 36,
          gapX: 12,
          gapY: 20,
        }),
      },
    ]);
    expect(node.scaleX()).toBe(1);
    expect(node.scaleY()).toBe(1);
  });

  it('commits generic multi-shape resize with independent x/y scale', () => {
    const map = mapWithTwoShapes();
    const first = mockShapeNode({ x: 0, y: 10 });
    const second = mockShapeNode({ x: 220, y: 15 });
    const stage = {
      findOne: (selector: string) => {
        if (selector === '#node-object-1') return first;
        if (selector === '#node-object-2') return second;
        return null;
      },
    };
    const transformer = { getActiveAnchor: () => 'middle-right', forceUpdate: () => undefined, rotation: () => 0 };

    const session = beginMapTransformSession({
      kind: 'generic',
      map,
      corridorIds: [],
      selectedObjectIds: ['object-1', 'object-2'],
      selectedSeatIds: [],
      selectedSeatGroupIds: [],
      stage: stage as never,
      transformer: transformer as never,
    });

    first.setScale(1.8, 0.75);
    second.setScale(1.8, 0.75);

    const commit = buildMapTransformCommit(session!, { stage: stage as never, transformer: transformer as never }, map);

    expect(commit.objectUpdates).toEqual([
      { id: 'object-1', patch: expect.objectContaining({ width: 180, height: 60 }) },
      { id: 'object-2', patch: expect.objectContaining({ width: 216, height: 45 }) },
    ]);
    expect(first.scaleX()).toBe(1);
    expect(first.scaleY()).toBe(1);
  });
});
