import {
  normalizeRotation,
  orbitPointAroundPivot,
  rotatePoint,
  shortestRotationDelta,
  snapAngleToStep,
  snapSmartCorridorRotation,
  toGlobal,
  toLocal,
} from '../geometry/rotation.js';

import { describe, expect, it } from 'vitest';

describe('geometry/rotation', () => {
  it('normalizes angles to [0, 360)', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(0.0005)).toBe(0);
  });

  it('snaps to quarter turns', () => {
    expect(snapSmartCorridorRotation(44)).toBe(0);
    expect(snapSmartCorridorRotation(46)).toBe(90);
    expect(snapAngleToStep(170, 45)).toBe(180);
  });

  it('rotates a point around a pivot', () => {
    const rotated = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(rotated.x).toBeCloseTo(0, 4);
    expect(rotated.y).toBeCloseTo(10, 4);
  });

  it('orbits around pivot by delta', () => {
    const result = orbitPointAroundPivot({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(result.x).toBeCloseTo(0, 4);
    expect(result.y).toBeCloseTo(10, 4);
  });

  it('converts local/global with inverse pair', () => {
    const pivot = { x: 50, y: 50 };
    const world = { x: 60, y: 40 };
    const local = toLocal(world, pivot, 90);
    const back = toGlobal(local, pivot, 90);
    expect(back.x).toBeCloseTo(world.x, 4);
    expect(back.y).toBeCloseTo(world.y, 4);
    expect(toLocal({ x: 114, y: 94 }, { x: 100, y: 80 }, 0)).toEqual({ x: 14, y: 14 });
  });

  it('computes shortest rotation delta', () => {
    expect(shortestRotationDelta(350, 10)).toBe(20);
    expect(shortestRotationDelta(10, 350)).toBe(-20);
  });
});
