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
});
