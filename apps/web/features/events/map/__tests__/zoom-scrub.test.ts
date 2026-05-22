import { describe, expect, it } from 'vitest';

import { applyScrubZoom, computeScrubDelta, computeScrubZoom } from '../lib/zoom-scrub';

describe('zoom-scrub', () => {
  it('increases zoom when dragging right or up', () => {
    expect(computeScrubDelta({ x: 120, y: 80 }, { x: 100, y: 100 })).toBeGreaterThan(0);
    expect(computeScrubZoom(1, computeScrubDelta({ x: 120, y: 80 }, { x: 100, y: 100 }))).toBeGreaterThan(1);
  });

  it('decreases zoom when dragging left or down', () => {
    expect(computeScrubDelta({ x: 80, y: 120 }, { x: 100, y: 100 })).toBeLessThan(0);
    expect(computeScrubZoom(1, computeScrubDelta({ x: 80, y: 120 }, { x: 100, y: 100 }))).toBeLessThan(1);
  });

  it('keeps the anchor point stable while scrubbing', () => {
    const result = applyScrubZoom({
      origin: { x: 100, y: 100 },
      current: { x: 180, y: 40 },
      startZoom: 0.8,
      startPan: { x: 120, y: 90 },
      anchor: { x: 240, y: 160 },
    });

    const worldX = (240 - 120) / 0.8;
    const worldY = (160 - 90) / 0.8;
    expect(result.pan.x).toBeCloseTo(240 - worldX * result.zoom, 4);
    expect(result.pan.y).toBeCloseTo(160 - worldY * result.zoom, 4);
  });
});
