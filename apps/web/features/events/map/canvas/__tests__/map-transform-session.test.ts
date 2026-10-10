import type { EventMapDTO } from '@alusa/domain';
import { describe, expect, it, vi } from 'vitest';
import { buildMapTransformCommit } from '../transform/map-transform-session';
import type { MapTransformSession } from '../transform/map-transform-session';

function createNode(attrs: { x: number; y: number; rotation?: number; scaleX?: number; scaleY?: number }) {
  const state = {
    x: attrs.x,
    y: attrs.y,
    rotation: attrs.rotation ?? 0,
    scaleX: attrs.scaleX ?? 1,
    scaleY: attrs.scaleY ?? 1,
  };
  const scaleX = vi.fn((value?: number) => {
    if (value !== undefined) state.scaleX = value;
    return state.scaleX;
  });
  const scaleY = vi.fn((value?: number) => {
    if (value !== undefined) state.scaleY = value;
    return state.scaleY;
  });
  return {
    x: () => state.x,
    y: () => state.y,
    rotation: () => state.rotation,
    scaleX,
    scaleY,
  };
}

describe('buildMapTransformCommit', () => {
  it('bakes independent shape scales and a uniform seat scale in one mixed commit', () => {
    const shapeNode = createNode({ x: 30, y: 40, rotation: 5, scaleX: 2, scaleY: 1.5 });
    const availableSeatNode = createNode({ x: 200, y: 300, rotation: 15, scaleX: 0.75, scaleY: 1.5 });
    const soldSeatNode = createNode({ x: 400, y: 500, scaleX: 2, scaleY: 2 });
    const stage = {
      findOne: vi.fn((selector: string) => ({
        '#node-shape-1': shapeNode,
        '#node-seat-available': availableSeatNode,
        '#node-seat-sold': soldSeatNode,
      })[selector] ?? null),
    };
    const map = {
      seats: [
        { id: 'seat-available', status: 'AVAILABLE', size: 32 },
        { id: 'seat-sold', status: 'SOLD', size: 30 },
      ],
    } as unknown as EventMapDTO;
    const session = {
      kind: 'generic',
      transformAnchor: 'bottom-right',
      initialTransformerRotation: 0,
      objectTransform: {
        snapshots: new Map([[
          'shape-1',
          { x: 10, y: 20, width: 100, height: 80, rotation: 0, type: 'GENERAL_AREA' },
        ]]),
        initialBounds: { x: 10, y: 20, width: 100, height: 80, centerX: 60, centerY: 60 },
        initialRotation: 0,
      },
      selectedObjectIds: ['shape-1'],
      selectedSeatIds: ['seat-available', 'seat-sold'],
      parametricItems: [],
      initialParametricTransforms: new Map(),
      parametricPreviewSnapshots: [],
    } as MapTransformSession;

    const commit = buildMapTransformCommit(session, { stage: stage as never, transformer: {} as never }, map);

    expect(commit.objectUpdates).toEqual([
      { id: 'shape-1', patch: { x: 30, y: 40, rotation: 5, width: 200, height: 120 } },
    ]);
    expect(commit.seatUpdates).toEqual([
      { id: 'seat-available', patch: { x: 200, y: 300, size: 48, rotation: 15 } },
    ]);
    expect(shapeNode.scaleX()).toBe(1);
    expect(shapeNode.scaleY()).toBe(1);
    expect(availableSeatNode.scaleX()).toBe(1);
    expect(availableSeatNode.scaleY()).toBe(1);
  });
});
