import { getCorridorWorldCenter } from '@alusa/domain';
import { applyCorridorNodeFromModel, applyLiveCorridorResizeToNode, applyLiveCorridorRotationToNode, buildCorridorGeometryAfterResize, buildCorridorGeometryAfterRotation, buildCorridorTransformCommitPatch, getCorridorCanvasAppearance, readCorridorPatchFromKonvaNode, resolveCorridorTransformSession } from '../corridor-canvas';
import { eventMapObjectToCorridorPolygon, polygonBounds } from '../corridor-domain-bridge';
import type { EventMapObjectDTO } from '../../api/event-map-service';

import { describe, expect, it } from 'vitest';

function corridorObject(overrides: Partial<EventMapObjectDTO> = {}): EventMapObjectDTO {
  return {
    id: 'corridor-1',
    levelId: 'level-1',
    sectionId: null,
    type: 'CORRIDOR',
    data: { smartCorridor: true, corridorAxis: 'vertical' },
    x: 100,
    y: 120,
    width: 32,
    height: 280,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
    ...overrides,
  };
}

function mockCorridorNode(attrs: {
  x: number;
  y: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  bodyWidth: number;
  bodyHeight: number;
}) {
  const state = {
    x: attrs.x,
    y: attrs.y,
    rotation: attrs.rotation ?? 0,
    scaleX: attrs.scaleX ?? 1,
    scaleY: attrs.scaleY ?? 1,
    bodyWidth: attrs.bodyWidth,
    bodyHeight: attrs.bodyHeight,
  };

  return {
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
    findOne: () => ({
      width: (value?: number) => {
        if (typeof value === 'number') state.bodyWidth = value;
        return state.bodyWidth;
      },
      height: (value?: number) => {
        if (typeof value === 'number') state.bodyHeight = value;
        return state.bodyHeight;
      },
    }),
    get state() {
      return state;
    },
  };
}

describe('corridor-canvas', () => {
  it('uses consistent visible styling for selected and unselected corridors', () => {
    const unselected = getCorridorCanvasAppearance(false, false);
    const selected = getCorridorCanvasAppearance(true, false);

    expect(unselected.strokeWidth).toBeGreaterThan(0);
    expect(unselected.dash.length).toBeGreaterThan(0);
    expect(selected.stroke).toBe('#7c3aed');
  });

  it('resolveCorridorTransformSession maps anchors to rotate or resize modes', () => {
    expect(resolveCorridorTransformSession('rotater')).toEqual({ mode: 'rotate', anchor: 'rotater' });
    expect(resolveCorridorTransformSession('middle-right')).toEqual({ mode: 'resize', anchor: 'middle-right' });
  });

  it('keeps x fixed when resizing from the right edge', () => {
    const object = corridorObject({ x: 434.48, y: 311.01, width: 329.71, height: 148.81, rotation: 0 });
    const node = mockCorridorNode({
      x: 353.16,
      y: 311.01,
      bodyWidth: 329.71,
      bodyHeight: 148.81,
      scaleX: 257.001892 / 329.71,
      scaleY: 1,
    });

    const geometry = buildCorridorGeometryAfterResize(object, node as never, 'middle-right');
    expect(geometry.x).toBeCloseTo(434.48, 4);
    expect(geometry.width).toBeCloseTo(257.001892, 3);
    expect(geometry.y).toBeCloseTo(311.01, 4);
    expect(geometry.height).toBeCloseTo(148.81, 4);
  });

  it('keeps the right edge fixed when resizing from the left edge', () => {
    const object = corridorObject({ x: 100, y: 120, width: 320, height: 140, rotation: 0 });
    const node = mockCorridorNode({
      x: 140,
      y: 120,
      bodyWidth: 320,
      bodyHeight: 140,
      scaleX: 240 / 320,
      scaleY: 1,
    });

    const geometry = buildCorridorGeometryAfterResize(object, node as never, 'middle-left');
    expect(geometry.x + geometry.width).toBeCloseTo(420, 4);
    expect(geometry.width).toBeCloseTo(240, 4);
  });

  it('keeps the opposite corner fixed when resizing uniformly from bottom-right', () => {
    const object = corridorObject({ x: 200, y: 160, width: 300, height: 180, rotation: 0 });
    const node = mockCorridorNode({
      x: 200,
      y: 160,
      bodyWidth: 300,
      bodyHeight: 180,
      scaleX: 0.75,
      scaleY: 0.5,
    });

    const geometry = buildCorridorGeometryAfterResize(object, node as never, 'bottom-right');
    expect(geometry.x).toBeCloseTo(200, 4);
    expect(geometry.y).toBeCloseTo(160, 4);
    expect(geometry.width).toBeCloseTo(225, 4);
    expect(geometry.height).toBeCloseTo(90, 4);
  });

  it('buildCorridorTransformCommitPatch returns rotation-only patch for rotate mode', () => {
    const object = corridorObject({ x: 100, y: 120, width: 380, height: 170, rotation: 0 });
    const centerBefore = getCorridorWorldCenter(object);
    const node = mockCorridorNode({
      x: 150,
      y: 80,
      rotation: 87,
      bodyWidth: 380,
      bodyHeight: 170,
    });

    const { patch, mode } = buildCorridorTransformCommitPatch(node as never, object, {
      mode: 'rotate',
      anchor: 'rotater',
    });
    expect(mode).toBe('rotate');
    expect(patch).toEqual({ rotation: 90 });
    expect(patch.x).toBeUndefined();

    const geometry = buildCorridorGeometryAfterRotation(object, patch.rotation ?? 0);
    const centerAfter = getCorridorWorldCenter({
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation,
    });
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 1);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 1);
  });

  it('applyLiveCorridorResizeToNode normalizes node attrs without moving the fixed edge', () => {
    const object = corridorObject({ x: 434.48, y: 311.01, width: 329.71, height: 148.81 });
    const node = mockCorridorNode({
      x: 353.16,
      y: 311.01,
      bodyWidth: 329.71,
      bodyHeight: 148.81,
      scaleX: 257.001892 / 329.71,
      scaleY: 1,
    });

    applyLiveCorridorResizeToNode(node as never, object, 'middle-right');
    expect(node.state.x).toBeCloseTo(434.48, 4);
    expect(node.state.bodyWidth).toBeCloseTo(257.001892, 3);
    expect(node.state.scaleX).toBe(1);
    expect(node.state.scaleY).toBe(1);
  });

  it('applyLiveCorridorRotationToNode preserves center without snapping during drag', () => {
    const object = corridorObject({ width: 380, height: 170 });
    const centerBefore = getCorridorWorldCenter(object);
    const node = mockCorridorNode({
      x: object.x,
      y: object.y,
      rotation: 45,
      bodyWidth: 380,
      bodyHeight: 170,
    });

    applyLiveCorridorRotationToNode(node as never, object, 45);
    expect(node.state.rotation).toBe(45);

    const centerAfter = getCorridorWorldCenter({
      x: node.state.x,
      y: node.state.y,
      width: object.width,
      height: object.height,
      rotation: node.state.rotation,
    });
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 4);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 4);
  });

  it('readCorridorPatchFromKonvaNode delegates to anchor-aware resize geometry', () => {
    const object = corridorObject({ x: 100, y: 120, width: 200, height: 80 });
    const node = mockCorridorNode({
      x: 100,
      y: 120,
      bodyWidth: 200,
      bodyHeight: 80,
      scaleX: 0.5,
      scaleY: 1,
    });

    const patch = readCorridorPatchFromKonvaNode(node as never, object, 'middle-right');
    expect(patch).toEqual({
      x: 100,
      y: 120,
      width: 100,
      height: 80,
      rotation: 0,
    });
  });

  it('keeps the world left edge fixed when resizing middle-right at 90 degrees', () => {
    const object = corridorObject({ x: 607.72, y: 194.43, width: 295.1, height: 73.31, rotation: 90 });
    const baseAabb = polygonBounds(eventMapObjectToCorridorPolygon(object));
    const centerBefore = getCorridorWorldCenter(object);
    const node = mockCorridorNode({
      x: object.x,
      y: object.y,
      rotation: 90,
      bodyWidth: 295.1,
      bodyHeight: 73.31,
      scaleX: 1,
      scaleY: 1.25,
    });

    const geometry = buildCorridorGeometryAfterResize(object, node as never, 'middle-right');
    const newAabb = polygonBounds(
      eventMapObjectToCorridorPolygon({
        ...object,
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        rotation: geometry.rotation,
      }),
    );
    const centerAfter = getCorridorWorldCenter(geometry);

    expect(newAabb.x).toBeCloseTo(baseAabb.x, 2);
    expect(geometry.width).toBeCloseTo(295.1, 2);
    expect(geometry.height).toBeCloseTo(73.31 * 1.25, 2);
    expect(centerAfter.x).not.toBeCloseTo(centerBefore.x, 1);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 2);
  });

  it('applyCorridorNodeFromModel keeps world center when setting rotation on node attrs', () => {
    const object = corridorObject({ rotation: 90 });
    const centerBefore = getCorridorWorldCenter(object);

    const attrs: Record<string, number> = {
      x: object.x,
      y: object.y,
      rotation: object.rotation ?? 0,
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
    };

    const node = {
      position: ({ x, y }: { x: number; y: number }) => {
        attrs.x = x;
        attrs.y = y;
      },
      rotation: (value?: number) => {
        if (typeof value === 'number') attrs.rotation = value;
        return attrs.rotation;
      },
      offsetX: (value?: number) => {
        if (typeof value === 'number') attrs.offsetX = value;
        return attrs.offsetX;
      },
      offsetY: (value?: number) => {
        if (typeof value === 'number') attrs.offsetY = value;
        return attrs.offsetY;
      },
      scaleX: (value?: number) => {
        if (typeof value === 'number') attrs.scaleX = value;
        return attrs.scaleX;
      },
      scaleY: (value?: number) => {
        if (typeof value === 'number') attrs.scaleY = value;
        return attrs.scaleY;
      },
      findOne: () => ({
        width: () => {},
        height: () => {},
      }),
    };

    applyCorridorNodeFromModel(node as never, object);

    expect(attrs.x).toBe(100);
    expect(attrs.y).toBe(120);
    expect(attrs.rotation).toBe(90);
    expect(attrs.offsetX).toBe(0);
    expect(attrs.offsetY).toBe(0);

    const centerAfter = getCorridorWorldCenter({
      x: attrs.x,
      y: attrs.y,
      width: object.width,
      height: object.height,
      rotation: attrs.rotation,
    });
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 4);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 4);
  });
});
