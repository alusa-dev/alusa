import { describe, expect, it } from 'vitest';
import { buildCanvasTransformCommand } from '../commit/build-canvas-transform-command';
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

describe('buildCanvasTransformCommand', () => {
  it('classifies translation-only drag as MOVE_OBJECTS', () => {
    const map = baseMap();
    const command = buildCanvasTransformCommand(
      { objects: [{ id: 'obj-1', patch: { x: 15, y: 17 } }] },
      map,
    );
    expect(command).toEqual({
      type: 'MOVE_OBJECTS',
      payload: {
        objectIds: ['obj-1'],
        seatIds: [],
        delta: { x: 5, y: -3 },
      },
    });
  });

  it('classifies rotation-only updates as ROTATE_SELECTION', () => {
    const map = baseMap();
    const command = buildCanvasTransformCommand(
      { objects: [{ id: 'obj-1', patch: { x: 10, y: 20, rotation: 45 } }] },
      map,
    );
    expect(command).toEqual({
      type: 'ROTATE_SELECTION',
      payload: {
        selection: [{ type: 'object', id: 'obj-1' }],
        angleDelta: 45,
        mode: 'free',
      },
    });
  });

  it('uses TRANSFORM_CORRIDOR when forced', () => {
    const map = baseMap();
    const command = buildCanvasTransformCommand(
      { objects: [{ id: 'obj-1', patch: { x: 15, y: 17 } }] },
      map,
      { forceCorridor: true },
    );
    expect(command?.type).toBe('TRANSFORM_CORRIDOR');
  });
});
