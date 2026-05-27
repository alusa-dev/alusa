import { getCorridorBounds, getCorridorUnionGroupByObjectId, getCorridorUnionGroups, isCorridorInCompositeUnion, mergePolygons, shouldRenderIndividualCorridorBody } from '../index';
import type { EventMapObjectDTO } from '../index';

import { describe, expect, it } from 'vitest';

function corridor(id: string, x: number, y: number, width: number, height: number, rotation = 0): EventMapObjectDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: null,
    type: 'CORRIDOR',
    data: { smartCorridor: true, corridorAxis: width <= height ? 'vertical' : 'horizontal' },
    x,
    y,
    width,
    height,
    rotation,
    locked: false,
    hidden: false,
    sortOrder: 0,
  };
}

describe('corridor-union', () => {
  it('uses rotated polygon bounds for corridor geometry', () => {
    const bounds = getCorridorBounds(corridor('corridor-1', 100, 50, 40, 180, 90));
    expect(bounds.x).toBeCloseTo(-80, 1);
    expect(bounds.y).toBeCloseTo(50, 1);
    expect(bounds.width).toBeCloseTo(180, 1);
    expect(bounds.height).toBeCloseTo(40, 1);
  });

  it('merges touching or overlapping corridors into one polygon union group', () => {
    const groups = getCorridorUnionGroups([
      corridor('corridor-1', 100, 50, 40, 180),
      corridor('corridor-2', 120, 120, 180, 40),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.objectIds.sort()).toEqual(['corridor-1', 'corridor-2']);
    expect(groups[0]?.mergedPolygons.length).toBeGreaterThan(0);
    expect(groups[0]?.mergedPolygons[0]?.length).toBeGreaterThanOrEqual(4);
  });

  it('builds a T-shaped union without relying on per-rect segment artifacts', () => {
    const groups = getCorridorUnionGroups([
      corridor('vertical', 200, 100, 32, 200),
      corridor('horizontal', 120, 180, 200, 32),
    ]);

    expect(groups).toHaveLength(1);
    const merged = groups[0]!.mergedPolygons[0]!;
    expect(merged.length).toBeGreaterThan(4);
  });

  it('keeps separated corridors as different visual groups', () => {
    const groups = getCorridorUnionGroups([
      corridor('corridor-1', 100, 50, 40, 180),
      corridor('corridor-2', 300, 120, 180, 40),
    ]);

    expect(groups).toHaveLength(2);
  });

  it('defers individual body rendering for composite union members', () => {
    const groups = getCorridorUnionGroups([
      corridor('corridor-1', 100, 50, 40, 180),
      corridor('corridor-2', 120, 120, 180, 40),
    ]);

    expect(isCorridorInCompositeUnion(groups, 'corridor-1')).toBe(true);
    expect(
      shouldRenderIndividualCorridorBody({
        objectId: 'corridor-2',
        selected: false,
        dragging: false,
        groups,
      }),
    ).toBe(false);
    expect(
      shouldRenderIndividualCorridorBody({
        objectId: 'corridor-2',
        selected: true,
        dragging: false,
        groups,
      }),
    ).toBe(true);
    expect(
      shouldRenderIndividualCorridorBody({
        objectId: 'corridor-2',
        selected: false,
        dragging: true,
        groups,
      }),
    ).toBe(true);
  });

  it('resolves union group lookup by object id', () => {
    const groups = getCorridorUnionGroups([
      corridor('corridor-1', 100, 50, 40, 180),
      corridor('corridor-2', 120, 120, 180, 40),
    ]);

    expect(getCorridorUnionGroupByObjectId(groups, 'corridor-2')?.objectIds).toContain('corridor-1');
  });

  it('does not crash when clipping receives fractional near-collinear corridor polygons', () => {
    const first = [
      { x: 355.0881913650565, y: 80.59906797075931 },
      { x: 355.18223477209494, y: 80.59906797075931 },
      { x: 355.18223477209494, y: 796.4845135958423 },
      { x: 355.0881913650565, y: 796.4845135958423 },
    ];
    const second = [
      { x: 260.25, y: 350.125 },
      { x: 640.75, y: 350.125 },
      { x: 640.75, y: 382.875 },
      { x: 260.25, y: 382.875 },
    ];

    expect(() => mergePolygons([first, second])).not.toThrow();
    expect(mergePolygons([first, second]).length).toBeGreaterThan(0);
  });
});
