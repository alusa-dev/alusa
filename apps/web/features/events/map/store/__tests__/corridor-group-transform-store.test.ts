import {
  buildCorridorGroupRotationUpdates,
  buildCorridorTransformSnapshot,
  buildSmartCorridorTransformPreview,
  cloneEventMap,
  getCorridorGroupPivot,
} from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO } from '../../api/event-map-service';
import { useEventMapEditorStore } from '../event-map-editor-store';

import { describe, expect, it } from 'vitest';

function corridor(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
): EventMapObjectDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: null,
    type: 'CORRIDOR',
    data: { smartCorridor: true, corridorAxis: width <= height ? 'vertical' : 'horizontal' },
    x,
    y,
    width,
    height,
    rotation,
    locked: false,
    hidden: false,
    sortOrder: 0,
  };
}

describe('corridor group transform store integration', () => {
  it('commits both corridors with group geometry through the store', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const baseMap = {
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
      levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1440, heightPx: 900, unit: 'px', scale: null }],
      sections: [],
      objects: [vertical, horizontal],
      seats: [],
      seatGroups: [],
      versions: [],
      counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
    } satisfies EventMapDTO;

    const pivot = getCorridorGroupPivot([vertical, horizontal]);
    const snapshots = [vertical, horizontal].map((object) => buildCorridorTransformSnapshot(object));
    const updates = buildCorridorGroupRotationUpdates(snapshots, pivot, 90, { snap: true });
    const patches = updates.map((update) => ({
      objectId: update.id,
      patch: update.geometry,
      mode: 'group-rotate' as const,
    }));

    const preview = buildSmartCorridorTransformPreview(cloneEventMap(baseMap), patches);
    const store = useEventMapEditorStore;
    store.getState().loadMap(baseMap);
    store.getState().applyTransform({
      type: 'RESIZE_OBJECTS',
      payload: {
        objects: updates.map((update) => ({ id: update.id, patch: update.geometry })),
        skipCorridorReflow: true,
      },
    });

    const committedVertical = store.getState().map?.objects.find((object) => object.id === 'vertical');
    const committedHorizontal = store.getState().map?.objects.find((object) => object.id === 'horizontal');
    const previewVertical = preview.objects.find((object) => object.id === 'vertical');
    const previewHorizontal = preview.objects.find((object) => object.id === 'horizontal');

    expect(committedVertical?.rotation).toBe(90);
    expect(committedHorizontal?.rotation).toBe(90);
    expect(committedVertical?.x).toBeCloseTo(previewVertical!.x, 3);
    expect(committedVertical?.y).toBeCloseTo(previewVertical!.y, 3);
    expect(committedHorizontal?.x).toBeCloseTo(previewHorizontal!.x, 3);
    expect(committedHorizontal?.y).toBeCloseTo(previewHorizontal!.y, 3);
  });
});
