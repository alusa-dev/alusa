import { resolveResizeSnapGuides } from '@alusa/domain';
import type { BoundingBox, CorridorTransformGeometry, LevelBounds } from '@alusa/domain';

/** Apply resize snap guides to corridor geometry at commit time. */
export function snapCorridorGeometryAtCommit(
  geometry: CorridorTransformGeometry,
  anchor: string,
  levelBounds: LevelBounds,
  objectBounds: BoundingBox[],
  options?: { snapDisabled?: boolean; threshold?: number },
): CorridorTransformGeometry {
  if (options?.snapDisabled) return geometry;

  const proposedBox: BoundingBox = {
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  };

  const { snappedBox } = resolveResizeSnapGuides({
    proposedBox,
    anchor,
    levelBounds,
    objectBounds,
    threshold: options?.threshold,
  });

  return {
    ...geometry,
    x: snappedBox.x,
    y: snappedBox.y,
    width: snappedBox.width,
    height: snappedBox.height,
  };
}
