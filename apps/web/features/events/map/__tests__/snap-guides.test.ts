import { describe, expect, it } from 'vitest';

import {
  buildGuideStops,
  buildSnappingEdgesFromRect,
  computeGuideSpan,
  computeSnapDelta,
  computeUnionBounds,
  findSnapGuides,
  getBoxEdge,
  getSnapReleaseThreshold,
  getSnapThreshold,
  isFiniteBoundingBox,
  isSnapModifierActive,
} from '../lib/snap-guides';
import { createSnapGuideStopCache } from '../lib/snap-guide-cache';

const levelBounds = { width: 1000, height: 800 };

describe('snap-guides', () => {
  it('includes level edges, center, and object bounds in guide stops', () => {
    const stops = buildGuideStops(levelBounds, [{ x: 100, y: 50, width: 200, height: 120 }]);

    expect(stops.vertical.map((entry) => entry.value)).toEqual(
      expect.arrayContaining([0, 500, 1000, 100, 200, 300]),
    );
    expect(stops.horizontal.map((entry) => entry.value)).toEqual(
      expect.arrayContaining([0, 400, 800, 50, 110, 170]),
    );
  });

  it('snaps the closest vertical guide and prefers object alignment over page', () => {
    const referenceBox = { x: 200, y: 100, width: 100, height: 80 };
    const draggedBox = { x: 203, y: 50, width: 100, height: 80 };
    const stops = buildGuideStops(levelBounds, [referenceBox]);
    const edges = buildSnappingEdgesFromRect(draggedBox, { x: 203, y: 50 });

    const guides = findSnapGuides(stops, edges, draggedBox, levelBounds, 8);

    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({
      lineGuide: 200,
      offset: 0,
      orientation: 'V',
      snap: 'start',
      source: 'object',
    });
    expect(guides[0]?.span.start).toBeLessThanOrEqual(Math.min(draggedBox.y, referenceBox.y));
    expect(guides[0]?.span.end).toBeGreaterThanOrEqual(
      Math.max(draggedBox.y + draggedBox.height, referenceBox.y + referenceBox.height),
    );
  });

  it('snaps object centers to the page center when within threshold', () => {
    const draggedBox = { x: 482, y: 382, width: 40, height: 40 };
    const stops = buildGuideStops(levelBounds, []);
    const edges = buildSnappingEdgesFromRect(draggedBox, { x: 482, y: 382 });

    const guides = findSnapGuides(stops, edges, draggedBox, levelBounds, 8);

    expect(guides).toEqual([
      expect.objectContaining({
        lineGuide: 500,
        offset: -20,
        orientation: 'V',
        snap: 'center',
        source: 'page',
        span: { start: 0, end: 800 },
      }),
      expect.objectContaining({
        lineGuide: 400,
        offset: -20,
        orientation: 'H',
        snap: 'center',
        source: 'page',
        span: { start: 0, end: 1000 },
      }),
    ]);
  });

  it('draws object guides only between aligned elements', () => {
    const draggedBox = { x: 120, y: 220, width: 80, height: 60 };
    const referenceBox = { x: 120, y: 80, width: 80, height: 60 };

    const span = computeGuideSpan('V', draggedBox, referenceBox, levelBounds, 'object');

    expect(span.start).toBe(76);
    expect(span.end).toBe(284);
  });

  it('computes snap delta for a multi-selection bounding box', () => {
    const groupBox = computeUnionBounds([
      { x: 395, y: 100, width: 80, height: 60 },
      { x: 395, y: 200, width: 80, height: 60 },
    ]);
    const stops = buildGuideStops(levelBounds, [{ x: 400, y: 120, width: 80, height: 60 }]);
    const edges = buildSnappingEdgesFromRect(groupBox, { x: groupBox.x, y: groupBox.y });
    const guides = findSnapGuides(stops, edges, groupBox, levelBounds, 8);
    const delta = computeSnapDelta(guides, groupBox);

    expect(guides[0]).toMatchObject({ orientation: 'V', lineGuide: 400, source: 'object' });
    expect(getBoxEdge(groupBox, 'V', 'start') + delta.x).toBe(400);
    expect(delta.y).toBe(0);
  });

  it('prioritizes page center for multi-selection when an object guide is similarly close', () => {
    const groupBox = { x: 450, y: 100, width: 90, height: 80 };
    const stops = buildGuideStops(levelBounds, [{ x: 447, y: 100, width: 80, height: 60 }]);
    const edges = buildSnappingEdgesFromRect(groupBox, { x: groupBox.x, y: groupBox.y });

    const guides = findSnapGuides(stops, edges, groupBox, levelBounds, 8, 'multi');

    expect(guides[0]).toMatchObject({
      orientation: 'V',
      lineGuide: 500,
      source: 'page',
      snap: 'center',
    });
  });

  it('keeps object alignment preferred for single-object drags', () => {
    const draggedBox = { x: 450, y: 100, width: 90, height: 80 };
    const stops = buildGuideStops(levelBounds, [{ x: 447, y: 100, width: 80, height: 60 }]);
    const edges = buildSnappingEdgesFromRect(draggedBox, { x: draggedBox.x, y: draggedBox.y });

    const guides = findSnapGuides(stops, edges, draggedBox, levelBounds, 8, 'single');

    expect(guides[0]).toMatchObject({
      orientation: 'V',
      lineGuide: 447,
      source: 'object',
      snap: 'start',
    });
  });

  it('scales snap threshold inversely with zoom for consistent screen feel', () => {
    expect(getSnapThreshold(1)).toBe(8);
    expect(getSnapThreshold(2)).toBe(4);
    expect(getSnapThreshold(0.5)).toBe(16);
    expect(getSnapThreshold(0.1)).toBe(8 / 0.25);
  });

  it('uses a wider release threshold so active guides do not flicker near the edge', () => {
    expect(getSnapReleaseThreshold(1)).toBe(12);
    expect(getSnapReleaseThreshold(2)).toBe(6);
    expect(getSnapReleaseThreshold(0.5)).toBe(24);
    expect(getSnapReleaseThreshold(0.1)).toBe(12 / 0.25);
  });

  it('rejects non-finite bounding boxes', () => {
    expect(isFiniteBoundingBox({ x: 0, y: 0, width: 100, height: 80 })).toBe(true);
    expect(isFiniteBoundingBox({ x: NaN, y: 0, width: 100, height: 80 })).toBe(false);
    expect(isFiniteBoundingBox({ x: 0, y: 0, width: -1, height: 80 })).toBe(false);
  });

  it('detects alt modifier on native and Konva-style events', () => {
    expect(isSnapModifierActive(undefined)).toBe(false);
    expect(isSnapModifierActive({ altKey: true } as MouseEvent)).toBe(true);
    expect(isSnapModifierActive({ evt: { altKey: true } as MouseEvent })).toBe(true);
    expect(isSnapModifierActive({ evt: { altKey: false } as MouseEvent })).toBe(false);
  });
});
