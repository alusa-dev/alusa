import { buildUniformTransformUpdates, clampUniformScale, computeUniformScale, computeUniformTransformPatch, getObjectTransformSnapshot, getSnapshotsUnionBounds, resolveLiveUniformScale } from '../index';
import type { EventMapObjectDTO } from '../index';

import { describe, expect, it } from 'vitest';

function shape(id: string): EventMapObjectDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: null,
    type: 'GENERAL_AREA',
    data: {},
    x: 100,
    y: 100,
    width: 200,
    height: 80,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
  };
}

function text(id: string): EventMapObjectDTO {
  return {
    ...shape(id),
    type: 'TEXT',
    width: 200,
    height: null,
    y: 120,
    data: { text: 'Bryan de alencar', fontSize: 22 },
  };
}

describe('uniform-group-transform', () => {
  it('uses transformer width ratio for proportional scale', () => {
    const initial = { x: 0, y: 0, width: 100, height: 80, centerX: 50, centerY: 40 };
    const next = { x: 0, y: 0, width: 150, height: 120, centerX: 75, centerY: 60 };
    expect(computeUniformScale(initial, next)).toBe(1.5);
  });

  it('keeps top-left position relative to the group center', () => {
    const textSnap = {
      x: 110,
      y: 120,
      width: 100,
      height: 30,
      rotation: 0,
      fontSize: 22,
      textMode: 'single-line' as const,
      type: 'TEXT',
    };
    const patch = computeUniformTransformPatch(textSnap, 200, 150, 2, 0);
    expect(patch.x).toBe(20);
    expect(patch.y).toBe(90);
    expect(patch.data?.fontSize).toBe(44);
  });

  it('scales text and shape together from the group center', () => {
    const shapeSnap = getObjectTransformSnapshot(shape('shape'));
    const textSnap = getObjectTransformSnapshot(text('text'));
    const bounds = getSnapshotsUnionBounds([shapeSnap, textSnap]);
    const scale = 1.5;

    const shapePatch = computeUniformTransformPatch(shapeSnap, bounds.centerX, bounds.centerY, scale, 0);
    const textPatch = computeUniformTransformPatch(textSnap, bounds.centerX, bounds.centerY, scale, 0);

    expect(shapePatch.width).toBeCloseTo(300, 0);
    expect(shapePatch.height).toBeCloseTo(120, 0);
    expect(textPatch.data?.fontSize).toBeCloseTo(33, 0);
    expect(textPatch.width).toBeNull();
    expect(textPatch.height).toBeNull();
  });

  it('builds batch updates for all members', () => {
    const snapshots = new Map([
      ['shape', getObjectTransformSnapshot(shape('shape'))],
      ['text', getObjectTransformSnapshot(text('text'))],
    ]);
    const bounds = getSnapshotsUnionBounds([...snapshots.values()]);
    const updates = buildUniformTransformUpdates(snapshots, bounds.centerX, bounds.centerY, 2, 0);

    expect(updates).toHaveLength(2);
    expect(updates.find((entry) => entry.id === 'text')?.patch.data?.fontSize).toBe(44);
  });

  it('reads live scale below 1 when shrinking', () => {
    const snapshots = new Map([['shape', getObjectTransformSnapshot(shape('shape'))]]);
    const scale = resolveLiveUniformScale(snapshots, (objectId) =>
      objectId === 'shape' ? { scaleX: 0.6, scaleY: 0.6 } : null,
    );
    expect(scale).toBe(0.6);
  });

  it('does not clamp dimensions during live transform', () => {
    const shapeSnap = getObjectTransformSnapshot(shape('shape'));
    const patch = computeUniformTransformPatch(shapeSnap, 200, 150, 0.4, 0);
    expect(patch.width).toBe(80);
    expect(patch.height).toBe(32);
  });
});
