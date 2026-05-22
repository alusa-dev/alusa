import { describe, expect, it } from 'vitest';

import {
  applyResizeSnapGuides,
  getFixedPointFromAnchor,
  getMovingEdgesFromAnchor,
  normalizeResizeBox,
  resolveAnchorResizeSnap,
  resolveResizeSnapGuides,
  restoreResizeBoxSigns,
} from '../lib/resize-snap-guides';

const levelBounds = { width: 1000, height: 800 };

describe('resize-snap-guides', () => {
  it('maps transformer anchors to the moving edges', () => {
    expect(getMovingEdgesFromAnchor('top-left')).toEqual({ vertical: 'start', horizontal: 'start' });
    expect(getMovingEdgesFromAnchor('middle-right')).toEqual({ vertical: 'end' });
    expect(getMovingEdgesFromAnchor('bottom-center')).toEqual({ horizontal: 'end' });
  });

  it('normalizes negative width/height from Konva and restores signs', () => {
    const normalized = normalizeResizeBox({ x: 300, y: 200, width: -120, height: -80 });

    expect(normalized).toMatchObject({ x: 180, y: 120, width: 120, height: 80, flippedX: true, flippedY: true });

    const restored = restoreResizeBoxSigns(normalized, normalized.flippedX, normalized.flippedY);
    expect(restored).toEqual({ x: 300, y: 200, width: -120, height: -80 });
  });

  it('snaps the moving right edge to a nearby object edge', () => {
    const referenceBox = { x: 100, y: 80, width: 200, height: 120 };
    const proposedBox = { x: 120, y: 140, width: 182, height: 90 };

    const result = resolveResizeSnapGuides({
      proposedBox,
      anchor: 'middle-right',
      levelBounds,
      objectBounds: [referenceBox],
      threshold: 8,
    });

    expect(result.snappedBox.width).toBe(180);
    expect(result.snappedBox.x + result.snappedBox.width).toBe(300);
    expect(result.guides).toEqual([
      expect.objectContaining({
        lineGuide: 300,
        orientation: 'V',
        snap: 'end',
        source: 'object',
      }),
    ]);
  });

  it('snaps the moving top edge to the page center horizontally', () => {
    const proposedBox = { x: 220, y: 404, width: 160, height: 120 };

    const result = resolveResizeSnapGuides({
      proposedBox,
      anchor: 'top-center',
      levelBounds,
      objectBounds: [],
      threshold: 8,
    });

    expect(result.snappedBox.y).toBe(400);
    expect(result.snappedBox.height).toBe(124);
    expect(result.guides).toEqual([
      expect.objectContaining({
        lineGuide: 400,
        orientation: 'H',
        snap: 'start',
        source: 'page',
      }),
    ]);
  });

  it('snaps both axes when resizing from a corner handle', () => {
    const referenceBox = { x: 500, y: 300, width: 100, height: 80 };
    const proposedBox = { x: 198, y: 148, width: 304, height: 154 };

    const result = resolveResizeSnapGuides({
      proposedBox,
      anchor: 'bottom-right',
      levelBounds,
      objectBounds: [referenceBox],
      threshold: 8,
    });

    expect(result.snappedBox).toEqual({ x: 198, y: 148, width: 302, height: 152 });
    expect(result.snappedBox.x + result.snappedBox.width).toBe(500);
    expect(result.snappedBox.y + result.snappedBox.height).toBe(300);
    expect(result.guides).toHaveLength(2);
  });

  it('snaps anchor position to nearby object edges during resize', () => {
    const referenceBox = { x: 100, y: 80, width: 200, height: 120 };
    const result = resolveAnchorResizeSnap({
      layerPos: { x: 303, y: 200 },
      anchor: 'middle-right',
      levelBounds,
      objectBounds: [referenceBox],
      referenceBox: { x: 120, y: 140, width: 182, height: 90 },
      threshold: 8,
    });

    expect(result.layerPos.x).toBe(300);
    expect(result.guides).toEqual([
      expect.objectContaining({
        lineGuide: 300,
        orientation: 'V',
        snap: 'end',
      }),
    ]);
  });

  it('snaps anchor position to the page center during resize', () => {
    const result = resolveAnchorResizeSnap({
      layerPos: { x: 420, y: 404 },
      anchor: 'top-center',
      levelBounds,
      objectBounds: [],
      referenceBox: { x: 340, y: 404, width: 160, height: 120 },
      threshold: 8,
    });

    expect(result.layerPos.y).toBe(400);
    expect(result.guides).toEqual([
      expect.objectContaining({
        lineGuide: 400,
        orientation: 'H',
        snap: 'start',
        source: 'page',
      }),
    ]);
  });

  it('keeps the opposite corner fixed while snapping', () => {
    const box = { x: 100, y: 120, width: 180, height: 140 };
    const fixed = getFixedPointFromAnchor(box, 'top-left');

    const snapped = applyResizeSnapGuides(
      box,
      [
        {
          lineGuide: 80,
          offset: 0,
          orientation: 'V',
          snap: 'start',
          span: { start: 0, end: 800 },
          source: 'object',
        },
        {
          lineGuide: 90,
          offset: 0,
          orientation: 'H',
          snap: 'start',
          span: { start: 0, end: 1000 },
          source: 'object',
        },
      ],
      getMovingEdgesFromAnchor('top-left'),
      'top-left',
    );

    expect(snapped.x).toBe(80);
    expect(snapped.y).toBe(90);
    expect(snapped.x + snapped.width).toBe(fixed.x);
    expect(snapped.y + snapped.height).toBe(fixed.y);
  });
});
