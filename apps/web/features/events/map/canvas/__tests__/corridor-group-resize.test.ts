import { buildSmartCorridorTransformPreview, cloneEventMap, getCorridorWorldCenter, isCorridorRotationOnlyTransform } from '@alusa/domain';
import { buildCorridorTransformSnapshot, getCorridorGroupBounds } from '../corridor-group-transform';
import { buildCorridorGroupResizeUpdates, constrainAabbScaleForAnchor, mapLocalScaleToAabbScale, resolveLiveCorridorGroupScale } from '../corridor-group-resize';
import { corridorEditorPolygonsIntersect, eventMapObjectToCorridorPolygon, polygonBounds } from '../corridor-domain-bridge';
import type { EventMapObjectDTO } from '../../api/event-map-service';

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

describe('corridor-group-resize', () => {
  it('maps local Konva scale to AABB scale based on rotation', () => {
    expect(mapLocalScaleToAabbScale(0, 1.2, 1)).toEqual({ scaleX: 1.2, scaleY: 1 });
    expect(mapLocalScaleToAabbScale(90, 1, 1.2)).toEqual({ scaleX: 1.2, scaleY: 1 });
    expect(mapLocalScaleToAabbScale(180, 1.2, 1)).toEqual({ scaleX: 1.2, scaleY: 1 });
    expect(mapLocalScaleToAabbScale(270, 1, 1.2)).toEqual({ scaleX: 1.2, scaleY: 1 });
  });

  it('constrains AABB scale to the axes moved by the active anchor', () => {
    expect(constrainAabbScaleForAnchor('middle-right', { scaleX: 1.2, scaleY: 1.4 })).toEqual({
      scaleX: 1.2,
      scaleY: 1,
    });
    expect(constrainAabbScaleForAnchor('middle-left', { scaleX: 1.2, scaleY: 1.4 })).toEqual({
      scaleX: 1.2,
      scaleY: 1,
    });
    expect(constrainAabbScaleForAnchor('top-center', { scaleX: 1.2, scaleY: 1.4 })).toEqual({
      scaleX: 1,
      scaleY: 1.4,
    });
    expect(constrainAabbScaleForAnchor('bottom-right', { scaleX: 1.2, scaleY: 1.4 })).toEqual({
      scaleX: 1.2,
      scaleY: 1.4,
    });
  });

  it('scales multiple corridors from a shared fixed point preserving relative layout', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const objects = [vertical, horizontal];
    const bounds = getCorridorGroupBounds(objects);
    const snapshots = objects.map((object) => buildCorridorTransformSnapshot(object));

    const centerDistanceBefore = Math.hypot(
      snapshots[0]!.centerX - snapshots[1]!.centerX,
      snapshots[0]!.centerY - snapshots[1]!.centerY,
    );

    const updates = buildCorridorGroupResizeUpdates(snapshots, bounds, 'bottom-right', 1.5);
    expect(updates).toHaveLength(2);

    const resizedVertical = updates.find((entry) => entry.id === 'vertical')!.geometry;
    const resizedHorizontal = updates.find((entry) => entry.id === 'horizontal')!.geometry;

    const centerDistanceAfter = Math.hypot(
      getCorridorWorldCenter(resizedVertical).x - getCorridorWorldCenter(resizedHorizontal).x,
      getCorridorWorldCenter(resizedVertical).y - getCorridorWorldCenter(resizedHorizontal).y,
    );

    expect(centerDistanceAfter).toBeCloseTo(centerDistanceBefore * 1.5, 4);
    expect(resizedVertical.width).toBeCloseTo(60, 3);
    expect(resizedVertical.height).toBeCloseTo(270, 3);
    expect(resizedHorizontal.width).toBeCloseTo(270, 3);
    expect(resizedHorizontal.height).toBeCloseTo(60, 3);
  });

  it('keeps connected corridors intersecting after group resize', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const objects = [vertical, horizontal];
    const bounds = getCorridorGroupBounds(objects);
    const snapshots = objects.map((object) => buildCorridorTransformSnapshot(object));
    const updates = buildCorridorGroupResizeUpdates(snapshots, bounds, 'bottom-right', 1.25);

    const resizedVertical = {
      ...vertical,
      ...updates.find((entry) => entry.id === 'vertical')!.geometry,
    };
    const resizedHorizontal = {
      ...horizontal,
      ...updates.find((entry) => entry.id === 'horizontal')!.geometry,
    };

    expect(corridorEditorPolygonsIntersect(resizedVertical, resizedHorizontal)).toBe(true);
  });

  it('respects anchor fixed point on the group bounds', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const bounds = getCorridorGroupBounds([vertical, horizontal]);
    const snapshots = [vertical, horizontal].map((object) => buildCorridorTransformSnapshot(object));

    const fromBottomRight = buildCorridorGroupResizeUpdates(snapshots, bounds, 'bottom-right', 2);
    const fromTopLeft = buildCorridorGroupResizeUpdates(snapshots, bounds, 'top-left', 2);

    const verticalBottomRight = fromBottomRight.find((entry) => entry.id === 'vertical')!.geometry;
    const verticalTopLeft = fromTopLeft.find((entry) => entry.id === 'vertical')!.geometry;

    expect(verticalBottomRight.x).not.toBeCloseTo(verticalTopLeft.x, 1);
    expect(verticalBottomRight.y).not.toBeCloseTo(verticalTopLeft.y, 1);
    expect(verticalBottomRight.width).toBeCloseTo(verticalTopLeft.width, 3);
    expect(getCorridorWorldCenter(verticalTopLeft).x).toBeLessThan(getCorridorWorldCenter(verticalBottomRight).x);
  });

  it('does not treat group-resized geometry as rotation-only', () => {
    const vertical = corridor('vertical', 100, 50, 40, 180);
    const horizontal = corridor('horizontal', 120, 120, 180, 40);
    const bounds = getCorridorGroupBounds([vertical, horizontal]);
    const snapshots = [vertical, horizontal].map((object) => buildCorridorTransformSnapshot(object));
    const updates = buildCorridorGroupResizeUpdates(snapshots, bounds, 'bottom-right', 1.5);

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

  it('reads the maximum live scale from corridor nodes', () => {
    const snapshots = [
      buildCorridorTransformSnapshot(corridor('a', 0, 0, 40, 180)),
      buildCorridorTransformSnapshot(corridor('b', 80, 80, 180, 40)),
    ];

    const scale = resolveLiveCorridorGroupScale(snapshots, (objectId) => {
      if (objectId === 'a') return { scaleX: 1.2, scaleY: 1.1 };
      if (objectId === 'b') return { scaleX: 1.4, scaleY: 1.4 };
      return null;
    });

    expect(scale).toBeCloseTo(1.4, 3);
  });

  it('commits group resize through smart corridor transform preview', () => {
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

    const bounds = getCorridorGroupBounds([vertical, horizontal]);
    const snapshots = [vertical, horizontal].map((object) => buildCorridorTransformSnapshot(object));
    const updates = buildCorridorGroupResizeUpdates(snapshots, bounds, 'bottom-right', 1.5);
    const patches = updates.map((update) => ({
      objectId: update.id,
      patch: update.geometry,
      mode: 'group-resize' as const,
    }));

    const preview = buildSmartCorridorTransformPreview(cloneEventMap(baseMap), patches);
    const previewVertical = preview.objects.find((object) => object.id === 'vertical');
    const previewHorizontal = preview.objects.find((object) => object.id === 'horizontal');

    expect(previewVertical?.width).toBeCloseTo(60, 3);
    expect(previewVertical?.height).toBeCloseTo(270, 3);
    expect(previewHorizontal?.width).toBeCloseTo(270, 3);
    expect(previewHorizontal?.height).toBeCloseTo(60, 3);
  });
});
