import { applyCorridorTransformLivePreview, beginCorridorTransformToolSession, buildCorridorTransformCommitPatches, resetCorridorTransformer } from '../corridor-transform-session';
import type { EventMapObjectDTO } from '../../api/event-map-service';

import { describe, expect, it } from 'vitest';

function corridor(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
): EventMapObjectDTO {
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

function baseMap(objects: EventMapObjectDTO[]) {
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    name: 'Map',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    levels: [{ id: 'level-1', name: 'Main', widthPx: 1200, heightPx: 800, sortOrder: 0, unit: 'PX', scale: null }],
    objects,
    seats: [],
    seatGroups: [],
    versions: [],
    counts: { objects: objects.length, seats: 0 },
  } as any;
}

function mockCorridorNode(attrs: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
    bodyWidth: attrs.width,
    bodyHeight: attrs.height,
  };

  return {
    id: () => attrs.id,
    x: () => state.x,
    y: () => state.y,
    rotation: (value?: number) => {
      if (typeof value === 'number') state.rotation = value;
      return state.rotation;
    },
    scaleX: (value?: number) => {
      if (typeof value === 'number') state.scaleX = value;
      return state.scaleX;
    },
    scaleY: (value?: number) => {
      if (typeof value === 'number') state.scaleY = value;
      return state.scaleY;
    },
    offsetX: () => 0,
    offsetY: () => 0,
    width: () => 0,
    height: () => 0,
    position: ({ x, y }: { x: number; y: number }) => {
      state.x = x;
      state.y = y;
    },
    getClientRect: () => ({
      x: state.x,
      y: state.y,
      width: state.bodyWidth * Math.abs(state.scaleX),
      height: state.bodyHeight * Math.abs(state.scaleY),
    }),
    findOne: () => ({
      width: (value?: number) => {
        if (typeof value === 'number') state.bodyWidth = value;
        return state.bodyWidth;
      },
      height: (value?: number) => {
        if (typeof value === 'number') state.bodyHeight = value;
        return state.bodyHeight;
      },
      x: (value?: number) => {
        if (typeof value === 'number') state.x = value;
        return state.x;
      },
      y: (value?: number) => {
        if (typeof value === 'number') state.y = value;
        return state.y;
      },
    }),
  };
}

function mockStage(nodes: ReturnType<typeof mockCorridorNode>[]) {
  return {
    findOne: (selector: string) => {
      const id = selector.replace(/^#node-/, '');
      return nodes.find((node) => node.id() === id) ?? null;
    },
  };
}

function mockTransformer(options: { anchor?: string; rotation?: number } = {}) {
  let rotation = options.rotation ?? 0;
  return {
    getActiveAnchor: () => options.anchor ?? 'middle-right',
    rotation: (value?: number) => {
      if (typeof value === 'number') rotation = value;
      return rotation;
    },
    forceUpdate: () => undefined,
  };
}

describe('corridor-transform-session', () => {
  it('resets transformer rotation at session start', () => {
    const object = corridor('c1', 100, 120, 32, 280);
    const node = mockCorridorNode({ id: 'c1', x: 100, y: 120, width: 32, height: 280 });
    const stage = mockStage([node]);
    const transformer = mockTransformer({ rotation: 45 });

    const session = beginCorridorTransformToolSession(baseMap([object]), ['c1'], transformer as never, stage as never);

    expect(session).not.toBeNull();
    expect(transformer.rotation()).toBe(0);
    expect(session!.uniformGroupScale).toBe(false);
    expect(session!.resizeMode).toBe('edge');
  });

  it('does not bake resize geometry during live preview (Konva native scale)', () => {
    const object = corridor('c1', 100, 120, 32, 280);
    const node = mockCorridorNode({ id: 'c1', x: 100, y: 120, width: 32, height: 280, scaleX: 1.5 });
    const stage = mockStage([node]);
    const transformer = mockTransformer({ anchor: 'middle-right' });

    const session = beginCorridorTransformToolSession(baseMap([object]), ['c1'], transformer as never, stage as never);
    applyCorridorTransformLivePreview(session!, { stage: stage as never, transformer: transformer as never });

    expect(node.scaleX()).toBe(1.5);
    expect(node.findOne().width()).toBe(32);
  });

  it('builds rotate commit patches from transformer delta', () => {
    const object = corridor('c1', 100, 120, 32, 280);
    const node = mockCorridorNode({ id: 'c1', x: 100, y: 120, width: 32, height: 280 });
    const stage = mockStage([node]);
    const transformer = mockTransformer({ anchor: 'rotater' });

    const session = beginCorridorTransformToolSession(baseMap([object]), ['c1'], transformer as never, stage as never);
    transformer.rotation(90);
    node.rotation(90);

    const patches = buildCorridorTransformCommitPatches(session!, { stage: stage as never, transformer: transformer as never });

    expect(patches).toHaveLength(1);
    expect(patches[0]!.patch.rotation).toBe(90);
  });

  it('builds single resize commit patches from live scale on transformend', () => {
    const object = corridor('c1', 100, 120, 32, 280);
    const node = mockCorridorNode({ id: 'c1', x: 100, y: 120, width: 32, height: 280, scaleX: 1.5 });
    const stage = mockStage([node]);
    const transformer = mockTransformer({ anchor: 'middle-right' });

    const session = beginCorridorTransformToolSession(baseMap([object]), ['c1'], transformer as never, stage as never);
    const patches = buildCorridorTransformCommitPatches(session!, { stage: stage as never, transformer: transformer as never });

    expect(patches).toHaveLength(1);
    expect(patches[0]!.patch.width).toBeGreaterThan(32);
    expect(node.scaleX()).toBe(1);
  });

  it('resetCorridorTransformer clears wrapper rotation', () => {
    const transformer = mockTransformer({ rotation: 120 });
    resetCorridorTransformer(transformer as never);
    expect(transformer.rotation()).toBe(0);
  });
});
