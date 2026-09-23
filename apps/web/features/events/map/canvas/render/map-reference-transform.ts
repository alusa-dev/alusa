import type { MapReferenceTransform } from '@alusa/domain';

export type ReferenceNodeTransform = Pick<MapReferenceTransform, 'x' | 'y' | 'rotation'> & {
  scaleX: number;
  scaleY: number;
};

/** Convert Konva's absolute node scale into the uniform scale persisted by the map. */
export function mapReferenceTransformFromNode(
  current: MapReferenceTransform,
  node: ReferenceNodeTransform,
): MapReferenceTransform {
  const scaleX = Number.isFinite(node.scaleX) ? Math.abs(node.scaleX) : current.scale;
  const scaleY = Number.isFinite(node.scaleY) ? Math.abs(node.scaleY) : current.scale;

  return {
    x: Number.isFinite(node.x) ? node.x : current.x,
    y: Number.isFinite(node.y) ? node.y : current.y,
    scale: Math.max(0.05, (scaleX + scaleY) / 2),
    rotation: Number.isFinite(node.rotation) ? node.rotation : current.rotation,
  };
}
