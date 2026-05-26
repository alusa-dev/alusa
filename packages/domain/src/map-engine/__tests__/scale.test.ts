import {
  clampUniformScale,
  constrainAabbScaleForAnchor,
  localDimensionsFromAabbSize,
  mapLocalScaleToAabbScale,
} from '../geometry/scale.js';

import { describe, expect, it } from 'vitest';

describe('geometry/scale', () => {
  it('clamps uniform scale', () => {
    expect(clampUniformScale(0)).toBe(0.05);
    expect(clampUniformScale(100)).toBe(20);
  });

  it('maps local scale to AABB at quarter turns', () => {
    expect(mapLocalScaleToAabbScale(0, 2, 3)).toEqual({ scaleX: 2, scaleY: 3 });
    expect(mapLocalScaleToAabbScale(90, 2, 3)).toEqual({ scaleX: 3, scaleY: 2 });
  });

  it('constrains scale axes by anchor', () => {
    expect(constrainAabbScaleForAnchor('middle-right', { scaleX: 2, scaleY: 3 })).toEqual({
      scaleX: 2,
      scaleY: 1,
    });
  });

  it('swaps local dimensions from AABB at 90 degrees', () => {
    expect(localDimensionsFromAabbSize(100, 40, 90)).toEqual({ width: 40, height: 100 });
  });
});
