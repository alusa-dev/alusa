import { buildSmartCorridorTransformPreview, cloneEventMap, getCorridorWorldCenter, isCorridorRotationOnlyTransform } from '@alusa/domain';
import { buildCorridorGroupRotationUpdates, buildCorridorTransformSnapshot, getCorridorGroupPivot, resolveSnappedCorridorGroupRotation } from '../corridor-group-transform';
import { corridorEditorPolygonsIntersect } from '../corridor-domain-bridge';
import type { EventMapObjectDTO } from '../../api/event-map-service';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';

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

describe('corridor-group-transform', () => {
  it('rotates multiple corridors around a shared pivot preserving relative layout', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const objects = [vertical, horizontal];
    const pivot = getCorridorGroupPivot(objects);
    const snapshots = objects.map((object) => buildCorridorTransformSnapshot(object));

    const centerDistanceBefore = Math.hypot(
      snapshots[0]!.centerX - snapshots[1]!.centerX,
      snapshots[0]!.centerY - snapshots[1]!.centerY,
    );

    const updates = buildCorridorGroupRotationUpdates(snapshots, pivot, 90, { snap: true });
    expect(updates).toHaveLength(2);

    const rotatedVertical = updates.find((entry) => entry.id === 'vertical')!.geometry;
    const rotatedHorizontal = updates.find((entry) => entry.id === 'horizontal')!.geometry;

    const centerDistanceAfter = Math.hypot(
      getCorridorWorldCenter(rotatedVertical).x - getCorridorWorldCenter(rotatedHorizontal).x,
      getCorridorWorldCenter(rotatedVertical).y - getCorridorWorldCenter(rotatedHorizontal).y,
    );

    expect(centerDistanceAfter).toBeCloseTo(centerDistanceBefore, 4);
    expect(rotatedVertical.rotation).toBe(90);
    expect(rotatedHorizontal.rotation).toBe(90);
  });

  it('keeps connected corridors intersecting after a 90 degree group rotation', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const objects = [vertical, horizontal];
    const pivot = getCorridorGroupPivot(objects);
    const snapshots = objects.map((object) => buildCorridorTransformSnapshot(object));
    const updates = buildCorridorGroupRotationUpdates(snapshots, pivot, 90, { snap: true });

    const rotatedVertical = {
      ...vertical,
      ...updates.find((entry) => entry.id === 'vertical')!.geometry,
    };
    const rotatedHorizontal = {
      ...horizontal,
      ...updates.find((entry) => entry.id === 'horizontal')!.geometry,
    };

    expect(corridorEditorPolygonsIntersect(rotatedVertical, rotatedHorizontal)).toBe(true);
  });

  it('uses the union polygon center as the group pivot', () => {
    const objects = [corridor('a', 100, 50, 40, 180), corridor('b', 120, 120, 180, 40)];
    const pivot = getCorridorGroupPivot(objects);

    expect(pivot.centerX).toBeGreaterThan(100);
    expect(pivot.centerY).toBeGreaterThan(50);
    expect(pivot.centerY).toBeLessThan(230);
  });

  it('does not treat group-rotated geometry as rotation-only when x/y moved', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const pivot = getCorridorGroupPivot([vertical, horizontal]);
    const snapshots = [vertical, horizontal].map((object) => buildCorridorTransformSnapshot(object));
    const updates = buildCorridorGroupRotationUpdates(snapshots, pivot, 90, { snap: true });

    for (const update of updates) {
      const previous = update.id === 'vertical' ? vertical : horizontal;
      expect(
        isCorridorRotationOnlyTransform(
          {
            x: update.geometry.x,
            y: update.geometry.y,
            width: update.geometry.width,
            height: update.geometry.height,
            rotation: update.geometry.rotation,
          },
          previous,
        ),
      ).toBe(false);
    }
  });

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
    } as any;

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
    store.getState().updateMapItems({
      objects: updates.map((update) => ({ id: update.id, patch: update.geometry })),
      skipCorridorReflow: true,
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

  it('snaps inclined drag deltas to coherent quarter-turn geometry on commit', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const pivot = getCorridorGroupPivot([vertical, horizontal]);
    const snapshots = [vertical, horizontal].map((object) => buildCorridorTransformSnapshot(object));

    const livePreview = buildCorridorGroupRotationUpdates(snapshots, pivot, 50, { snap: false });
    const commitPreview = buildCorridorGroupRotationUpdates(snapshots, pivot, 50, { snap: true });
    const quarterTurn = buildCorridorGroupRotationUpdates(snapshots, pivot, 90, { snap: true });

    expect(commitPreview[0]!.geometry.rotation).toBe(90);
    expect(commitPreview[1]!.geometry.rotation).toBe(90);
    expect(commitPreview[0]!.geometry).toEqual(quarterTurn[0]!.geometry);
    expect(commitPreview[1]!.geometry).toEqual(quarterTurn[1]!.geometry);
    expect(livePreview[0]!.geometry.rotation).toBeCloseTo(50, 3);
    expect(livePreview[0]!.geometry.x).not.toBeCloseTo(commitPreview[0]!.geometry.x, 1);

    for (const update of commitPreview) {
      const center = getCorridorWorldCenter(update.geometry);
      const snapshot = snapshots.find((entry) => entry.id === update.id)!;
      const { effectiveDeltaDeg } = resolveSnappedCorridorGroupRotation(snapshot.rotation, 50);
      const rad = (effectiveDeltaDeg * Math.PI) / 180;
      const dx = snapshot.centerX - pivot.centerX;
      const dy = snapshot.centerY - pivot.centerY;
      const expectedCenterX = pivot.centerX + dx * Math.cos(rad) - dy * Math.sin(rad);
      const expectedCenterY = pivot.centerY + dx * Math.sin(rad) + dy * Math.cos(rad);
      expect(center.x).toBeCloseTo(expectedCenterX, 3);
      expect(center.y).toBeCloseTo(expectedCenterY, 3);
    }
  });
});
