import { applyDelta, translateBounds, translatePoint } from '../geometry/translation.js';

import { describe, expect, it } from 'vitest';

describe('geometry/translation', () => {
  it('translates points and bounds', () => {
    expect(translatePoint({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(applyDelta({ x: 1, y: 2 }, 3, 4)).toEqual({ x: 4, y: 6 });
    expect(translateBounds({ x: 0, y: 0, width: 10, height: 20 }, { x: 5, y: -2 })).toEqual({
      x: 5,
      y: -2,
      width: 10,
      height: 20,
    });
  });
});
