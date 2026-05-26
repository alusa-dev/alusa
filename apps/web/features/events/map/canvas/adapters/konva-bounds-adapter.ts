import type Konva from 'konva';
import { unionBounds, type BoundsRect } from '@alusa/domain';

export function getNodeBounds(node: Konva.Node): BoundsRect {
  const rect = node.getClientRect({ skipTransform: false });
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export function unionNodeBounds(nodes: Konva.Node[]): BoundsRect | null {
  return unionBounds(nodes.map((node) => getNodeBounds(node)));
}
