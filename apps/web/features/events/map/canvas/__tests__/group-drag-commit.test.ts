import { describe, expect, it } from 'vitest';
import { buildGroupDragCommit } from '../commit/group-drag-commit';
import type { GroupDragState } from '../sessions/use-drag-session';
import type { EventMapDTO } from '../../api/event-map-service';

function baseMap(): EventMapDTO {
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
    objects: [{
      id: 'obj-1',
      levelId: 'level-1',
      sectionId: null,
      type: 'STAGE',
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      rotation: 0,
      hidden: false,
      locked: false,
      sortOrder: 0,
      data: {},
    }],
    seatGroups: [],
    seats: [],
    versions: [],
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
  };
}

describe('buildGroupDragCommit', () => {
  it('builds translation payload for generic object drag updates', () => {
    const map = baseMap();
    const drag: GroupDragState = {
      anchorNodeId: 'node-obj-1',
      origin: new Map([['node-obj-1', { x: 10, y: 20 }]]),
      delta: { x: 5, y: -3 },
    };

    const result = buildGroupDragCommit({
      drag,
      map,
      baseMap: null,
      previewWorkingMap: null,
      corridorDragMode: null,
    });

    expect(result.kind).toBe('generic');
    expect(result.payload).toEqual({
      objects: [{ id: 'obj-1', patch: { x: 15, y: 17 } }],
      seats: [],
      seatGroups: [],
    });
  });

  it('returns noop when delta is below threshold', () => {
    const map = baseMap();
    const drag: GroupDragState = {
      anchorNodeId: 'node-obj-1',
      origin: new Map([['node-obj-1', { x: 10, y: 20 }]]),
      delta: { x: 0, y: 0 },
    };

    const result = buildGroupDragCommit({
      drag,
      map,
      baseMap: null,
      previewWorkingMap: null,
      corridorDragMode: null,
    });

    expect(result.kind).toBe('noop');
    expect(result.payload).toBeNull();
  });
});
