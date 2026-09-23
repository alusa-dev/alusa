import { describe, expect, it } from 'vitest';

import {
  getCreationBox,
  getCreationShape,
  getSeatBlockConfigForBounds,
  isCreationTool,
  isPlacementTool,
  isProportionalTool,
} from '../render/map-creation-draft';

describe('map-creation-draft', () => {
  it('detects creation and placement tools', () => {
    expect(isCreationTool('select')).toBe(false);
    expect(isCreationTool('shape-square')).toBe(true);
    expect(isPlacementTool('row')).toBe(true);
    expect(isProportionalTool('shape-circle')).toBe(true);
  });

  it('builds proportional creation boxes from drag direction', () => {
    const box = getCreationBox({
      tool: 'shape-square',
      start: { x: 100, y: 100 },
      current: { x: 160, y: 130 },
    });

    expect(box).toEqual({ x: 100, y: 100, width: 60, height: 60 });
  });

  it('builds non-proportional creation boxes', () => {
    const box = getCreationBox({
      tool: 'stage',
      start: { x: 200, y: 200 },
      current: { x: 150, y: 260 },
    });

    expect(box).toEqual({ x: 150, y: 200, width: 50, height: 60 });
  });

  it('maps creation tools to preview shapes', () => {
    expect(getCreationShape('shape-triangle')).toBe('triangle');
    expect(getCreationShape('text')).toBe(null);
  });

  it('derives a parametric block from the dragged bounds and calibration', () => {
    const draft = getSeatBlockConfigForBounds(
      { x: 100, y: 200, width: 160, height: 100 },
      { seatDiameter: 20, seatPitch: 10, rowPitch: 20 },
      5,
    );

    expect(draft.origin).toEqual({ x: 110, y: 210 });
    expect(draft.config).toMatchObject({ rows: 3, columns: 5, totalSeats: 15, startNumber: 5 });
  });
});
