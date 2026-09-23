import { describe, expect, it } from 'vitest';

import { mapReferenceTransformFromNode } from '../render/map-reference-transform';

describe('mapReferenceTransformFromNode', () => {
  it('persists Konva absolute scale rather than multiplying it by the old scale', () => {
    const transform = mapReferenceTransformFromNode(
      { x: 10, y: 20, scale: 2, rotation: 0 },
      { x: 30, y: 40, scaleX: 3, scaleY: 3, rotation: 45 },
    );

    expect(transform).toEqual({ x: 30, y: 40, scale: 3, rotation: 45 });
  });

  it('keeps a positive minimum scale and preserves prior values for invalid coordinates', () => {
    const transform = mapReferenceTransformFromNode(
      { x: 10, y: 20, scale: 0.5, rotation: 12 },
      { x: Number.NaN, y: Number.POSITIVE_INFINITY, scaleX: 0, scaleY: 0, rotation: Number.NaN },
    );

    expect(transform).toEqual({ x: 10, y: 20, scale: 0.05, rotation: 12 });
  });
});
