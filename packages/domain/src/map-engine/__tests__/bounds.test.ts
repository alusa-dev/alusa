import {
  centerOf,
  expandRect,
  intersectsRect,
  normalizeBoundsRect,
  unionBounds,
  type BoundsRect,
} from '../geometry/bounds.js';

describe('geometry/bounds', () => {
  it('normalizes marquee bounds', () => {
    expect(normalizeBoundsRect({ x: 10, y: 20 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 20,
    });
  });

  it('detects intersection', () => {
    const a: BoundsRect = { x: 0, y: 0, width: 10, height: 10 };
    const b: BoundsRect = { x: 5, y: 5, width: 10, height: 10 };
    expect(intersectsRect(a, b)).toBe(true);
    expect(intersectsRect(a, { x: 20, y: 20, width: 5, height: 5 })).toBe(false);
  });

  it('unions boxes', () => {
    expect(
      unionBounds([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 5, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 15, height: 15 });
  });

  it('expands and centers', () => {
    const rect = { x: 10, y: 20, width: 20, height: 40 };
    expect(expandRect(rect, 5)).toEqual({ x: 5, y: 15, width: 30, height: 50 });
    expect(centerOf(rect)).toEqual({ x: 20, y: 40 });
  });
});
