import { describe, expect, it } from 'vitest';

import type { EventMapObjectDTO } from '../api/event-map-service';
import { getCorridorBounds, getCorridorUnionGroups } from '../lib/corridor-union';

function corridor(id: string, x: number, y: number, width: number, height: number): EventMapObjectDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: null,
    type: 'CORRIDOR',
    data: {},
    x,
    y,
    width,
    height,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
  };
}

describe('corridor-union', () => {
  it('uses rotated bounds for corridor geometry', () => {
    const bounds = getCorridorBounds({
      ...corridor('corridor-1', 100, 50, 40, 180),
      rotation: 90,
    });

    expect(bounds).toEqual({ x: -80, y: 50, width: 180, height: 40 });
  });

  it('merges touching or overlapping corridors into one visual group', () => {
    const groups = getCorridorUnionGroups([
      corridor('corridor-1', 100, 50, 40, 180),
      corridor('corridor-2', 120, 120, 180, 40),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.objectIds.sort()).toEqual(['corridor-1', 'corridor-2']);
    expect(groups[0]?.segments.length).toBeGreaterThan(4);
  });

  it('keeps separated corridors as different visual groups', () => {
    const groups = getCorridorUnionGroups([
      corridor('corridor-1', 100, 50, 40, 180),
      corridor('corridor-2', 300, 120, 180, 40),
    ]);

    expect(groups).toHaveLength(2);
  });
});
