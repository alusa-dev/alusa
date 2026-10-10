import { describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { moveGroupDragNodes, type GroupDragState } from '../sessions/use-drag-session';

describe('moveGroupDragNodes', () => {
  it('moves object and parametric preview nodes by the same live pointer delta', () => {
    const objectNode = { x: vi.fn(), y: vi.fn() };
    const rowLineNode = { x: vi.fn(), y: vi.fn() };
    const drag: GroupDragState = {
      anchorNodeId: 'node-object-1',
      origin: new Map([
        ['node-object-1', { x: 10, y: 20 }],
        ['node-seatrow-line-row-1', { x: 40, y: 50 }],
      ]),
      nodes: new Map([
        ['node-seatrow-line-row-1', rowLineNode as unknown as Konva.Node],
        ['node-object-1', objectNode as unknown as Konva.Node],
      ]),
      bounds: null,
      delta: { x: 0, y: 0 },
      parametricItems: [{ type: 'seatblock', id: 'block-1' }],
    };

    moveGroupDragNodes(drag, 17, 14);

    expect(drag.delta).toEqual({ x: 7, y: -6 });
    expect(rowLineNode.x).toHaveBeenCalledWith(47);
    expect(rowLineNode.y).toHaveBeenCalledWith(44);
  });
});
