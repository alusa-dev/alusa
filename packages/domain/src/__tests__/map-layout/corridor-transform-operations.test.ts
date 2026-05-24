import { describe, expect, it } from 'vitest';

import { applyMapOperation } from '../../map-layout/operations/apply-map-operation';
import type { MapLayoutState } from '../../map-layout/state/types';
import type { SmartCorridor } from '../../map-layout/corridors/types';

function corridor(id: string, overrides: Partial<SmartCorridor> = {}): SmartCorridor {
  return {
    id,
    contaId: 'conta-1',
    levelId: 'level-1',
    x: 100,
    y: 100,
    thickness: 32,
    length: 200,
    rotation: 0,
    axis: 'VERTICAL',
    behavior: 'SPLIT_VISUAL_BLOCKS',
    clearance: 4,
    ...overrides,
  };
}

function stateWith(corridors: SmartCorridor[]): MapLayoutState {
  const map = new Map<string, SmartCorridor>();
  for (const c of corridors) map.set(c.id, c);
  return {
    mapId: 'map-1',
    levelId: 'level-1',
    seatGroups: new Map(),
    seats: new Map(),
    corridors: map,
  };
}

describe('corridor transform operations', () => {
  it('RESIZE_CORRIDOR_EDGE updates corridor geometry', () => {
    const initial = stateWith([corridor('c1')]);
    const result = applyMapOperation(initial, {
      kind: 'RESIZE_CORRIDOR_EDGE',
      corridorId: 'c1',
      bounds: { x: 100, y: 100, width: 48, height: 220 },
      rotation: 0,
      handle: 'middle-right',
    });

    const updated = result.state.corridors.get('c1')!;
    expect(updated.thickness).toBe(48);
    expect(updated.length).toBe(220);
  });

  it('ROTATE_CORRIDOR updates rotation and bounds', () => {
    const initial = stateWith([corridor('c1')]);
    const result = applyMapOperation(initial, {
      kind: 'ROTATE_CORRIDOR',
      corridorId: 'c1',
      rotation: 90,
      bounds: { x: 80, y: 120, width: 32, height: 200 },
    });

    expect(result.state.corridors.get('c1')!.rotation).toBe(90);
  });

  it('TRANSFORM_CORRIDOR_GROUP updates multiple corridors', () => {
    const initial = stateWith([corridor('c1'), corridor('c2', { x: 200, y: 100 })]);
    const result = applyMapOperation(initial, {
      kind: 'TRANSFORM_CORRIDOR_GROUP',
      corridorIds: ['c1', 'c2'],
      mode: 'group-resize',
      patches: [
        {
          corridorId: 'c1',
          bounds: { x: 100, y: 100, width: 40, height: 180 },
          rotation: 0,
        },
        {
          corridorId: 'c2',
          bounds: { x: 200, y: 100, width: 40, height: 180 },
          rotation: 0,
        },
      ],
    });

    expect(result.state.corridors.get('c1')!.thickness).toBe(40);
    expect(result.state.corridors.get('c2')!.thickness).toBe(40);
  });
});
