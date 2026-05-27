import { describe, expect, it, vi } from 'vitest';

import {
  captureTransformNodeSnapshots,
  readObjectTransformCommitFromNodes,
  readSeatGroupTransformFromNode,
  readSeatTransformFromNode,
  resetNodeScale,
} from '../adapters/konva-transform-adapter';

function mockNode(attrs: {
  x: number;
  y: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}) {
  const state = {
    x: attrs.x,
    y: attrs.y,
    rotation: attrs.rotation ?? 0,
    scaleX: attrs.scaleX ?? 1,
    scaleY: attrs.scaleY ?? 1,
  };

  return {
    x: () => state.x,
    y: () => state.y,
    rotation: () => state.rotation,
    scaleX: vi.fn((value?: number) => {
      if (typeof value === 'number') state.scaleX = value;
      return state.scaleX;
    }),
    scaleY: vi.fn((value?: number) => {
      if (typeof value === 'number') state.scaleY = value;
      return state.scaleY;
    }),
  };
}

describe('konva-transform-adapter', () => {
  it('resets node scale to 1', () => {
    const node = mockNode({ x: 0, y: 0, scaleX: 2, scaleY: 1.5 });
    resetNodeScale(node as never);
    expect(node.scaleX).toHaveBeenCalledWith(1);
    expect(node.scaleY).toHaveBeenCalledWith(1);
  });

  it('reads seat transform and bakes scale into size', () => {
    const node = mockNode({ x: 10, y: 20, rotation: 15, scaleX: 2, scaleY: 2 });
    const patch = readSeatTransformFromNode(node as never, 24);
    expect(patch).toEqual({ x: 10, y: 20, size: 48, rotation: 15 });
    expect(node.scaleX()).toBe(1);
  });

  it('reads seat group transform with uniform scale axes', () => {
    const node = mockNode({ x: 5, y: 6, rotation: 30, scaleX: 2, scaleY: 2 });
    const patch = readSeatGroupTransformFromNode(node as never, {
      seatWidth: 20,
      seatHeight: 20,
      gapX: 8,
      gapY: 8,
      paddingLeft: 4,
      paddingRight: 4,
      paddingTop: 4,
      paddingBottom: 4,
    });
    expect(patch).toMatchObject({
      x: 5,
      y: 6,
      rotation: 30,
      seatWidth: 40,
      seatHeight: 40,
      gapX: 16,
      gapY: 16,
    });
  });

  it('captures snapshots for leaf nodes without assuming a Konva container', () => {
    const node = mockNode({ x: 10, y: 20, rotation: 5, scaleX: 1.2, scaleY: 0.8 });
    const stage = {
      findOne: vi.fn((selector: string) => (selector === '#node-object-1' ? node : null)),
    };

    expect(captureTransformNodeSnapshots(stage as never, ['node-object-1'])).toEqual([
      {
        id: 'node-object-1',
        x: 10,
        y: 20,
        rotation: 5,
        scaleX: 1.2,
        scaleY: 0.8,
        bodyWidth: undefined,
        bodyHeight: undefined,
      },
    ]);
  });

  it('can bake independent x/y scale for native multi-object resize', () => {
    const node = mockNode({ x: 30, y: 40, rotation: 0, scaleX: 2, scaleY: 0.5 });
    const stage = {
      findOne: vi.fn((selector: string) => (selector === '#node-object-1' ? node : null)),
    };
    const session = {
      snapshots: new Map([
        [
          'object-1',
          {
            x: 10,
            y: 20,
            width: 100,
            height: 80,
            rotation: 0,
            type: 'GENERAL_AREA',
          },
        ],
      ]),
      initialBounds: { x: 10, y: 20, width: 100, height: 80, centerX: 60, centerY: 60 },
      initialRotation: 0,
      excludeCorridors: false,
    };

    const updates = readObjectTransformCommitFromNodes(stage as never, session, ['object-1'], {
      scaleMode: 'independent',
    });

    expect(updates[0]?.patch).toMatchObject({ x: 30, y: 40, width: 200, height: 40 });
  });
});
