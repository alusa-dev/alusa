import { describe, expect, it } from 'vitest';

import {
  applyTransform2DToPoint,
  composeTransform,
  IDENTITY_TRANSFORM,
  parentLocalToWorld,
  worldToParentLocal,
} from '../geometry/transform-compose.js';

describe('geometry/transform-compose', () => {
  it('round-trips world ↔ parent local', () => {
    const parent = { x: 100, y: 50, rotation: 90, scaleX: 1, scaleY: 1 };
    const world = { x: 120, y: 80 };
    const local = worldToParentLocal(world, parent);
    const back = parentLocalToWorld(local, parent);
    expect(back.x).toBeCloseTo(world.x, 4);
    expect(back.y).toBeCloseTo(world.y, 4);
  });

  it('composes nested transforms', () => {
    const parent = { x: 10, y: 20, rotation: 0, scaleX: 2, scaleY: 2 };
    const local = { x: 5, y: 0, rotation: 90, scaleX: 1, scaleY: 1 };
    const composed = composeTransform(parent, local);
    expect(composed.rotation).toBe(90);
    expect(composed.scaleX).toBe(2);
    expect(composed.x).toBeCloseTo(20, 4);
    expect(composed.y).toBeCloseTo(20, 4);
  });

  it('applies transform2D to a point', () => {
    const transform = { ...IDENTITY_TRANSFORM, x: 10, y: 5, rotation: 90 };
    const result = applyTransform2DToPoint({ x: 4, y: 0 }, transform);
    expect(result.x).toBeCloseTo(10, 4);
    expect(result.y).toBeCloseTo(9, 4);
  });
});
