import {
  buildGuideStops,
  buildSnappingEdgesFromRect,
  DEFAULT_SNAP_THRESHOLD,
  findSnapGuides,
  getBoxEdge,
  type BoundingBox,
  type LevelBounds,
  type SnapGuideLine,
  type SnappingEdges,
} from './snap-guides.js';
import { MIN_OBJECT_SIZE } from '../operations/transform/uniform-transform.js';

import {
  getFixedPointFromAnchor,
  getMovingEdgesFromAnchor,
  type MovingResizeEdges,
} from '../geometry/anchor.js';

export type NormalizedResizeBox = BoundingBox & {
  flippedX: boolean;
  flippedY: boolean;
};

export function normalizeResizeBox(box: BoundingBox): NormalizedResizeBox {
  let { x, y, width, height } = box;
  let flippedX = false;
  let flippedY = false;

  if (width < 0) {
    x += width;
    width = -width;
    flippedX = true;
  }

  if (height < 0) {
    y += height;
    height = -height;
    flippedY = true;
  }

  return { x, y, width, height, flippedX, flippedY };
}

export function restoreResizeBoxSigns(
  box: BoundingBox,
  flippedX: boolean,
  flippedY: boolean,
): BoundingBox {
  let { x, y, width, height } = box;

  if (flippedX) {
    x += width;
    width = -width;
  }

  if (flippedY) {
    y += height;
    height = -height;
  }

  return { x, y, width, height };
}

export function buildSnappingEdgesForResize(
  box: BoundingBox,
  moving: MovingResizeEdges,
): SnappingEdges {
  const edges: SnappingEdges = { vertical: [], horizontal: [] };

  if (moving.vertical) {
    edges.vertical.push({
      guide: getBoxEdge(box, 'V', moving.vertical),
      offset: 0,
      snap: moving.vertical,
    });
  }

  if (moving.horizontal) {
    edges.horizontal.push({
      guide: getBoxEdge(box, 'H', moving.horizontal),
      offset: 0,
      snap: moving.horizontal,
    });
  }

  return edges;
}

export function applyResizeSnapGuides(
  box: BoundingBox,
  guides: SnapGuideLine[],
  moving: MovingResizeEdges,
  anchor: string,
  minSize = MIN_OBJECT_SIZE,
): BoundingBox {
  let { x, y, width, height } = box;
  const fixed = getFixedPointFromAnchor(box, anchor);

  for (const guide of guides) {
    if (guide.orientation === 'V' && moving.vertical) {
      if (moving.vertical === 'start') {
        width = Math.max(minSize, fixed.x - guide.lineGuide);
        x = fixed.x - width;
      } else if (moving.vertical === 'end') {
        x = fixed.x;
        width = Math.max(minSize, guide.lineGuide - fixed.x);
      }
    }

    if (guide.orientation === 'H' && moving.horizontal) {
      if (moving.horizontal === 'start') {
        height = Math.max(minSize, fixed.y - guide.lineGuide);
        y = fixed.y - height;
      } else if (moving.horizontal === 'end') {
        y = fixed.y;
        height = Math.max(minSize, guide.lineGuide - fixed.y);
      }
    }
  }

  return { x, y, width, height };
}

export type ResizeSnapGuideResult = {
  guides: SnapGuideLine[];
  snappedBox: BoundingBox;
};

export function resolveAnchorResizeSnap({
  layerPos,
  anchor,
  levelBounds,
  objectBounds,
  referenceBox,
  threshold = DEFAULT_SNAP_THRESHOLD,
}: {
  layerPos: { x: number; y: number };
  anchor: string;
  levelBounds: LevelBounds;
  objectBounds: BoundingBox[];
  referenceBox: BoundingBox;
  threshold?: number;
}): { layerPos: { x: number; y: number }; guides: SnapGuideLine[] } {
  const moving = getMovingEdgesFromAnchor(anchor);
  if (!moving.vertical && !moving.horizontal) {
    return { layerPos, guides: [] };
  }

  const edges = buildSnappingEdgesForResize(
    {
      x: layerPos.x,
      y: layerPos.y,
      width: referenceBox.width,
      height: referenceBox.height,
    },
    moving,
  );

  // Anchor position is the moving edge/corner — snap it directly.
  if (moving.vertical) {
    edges.vertical[0] = { guide: layerPos.x, offset: 0, snap: moving.vertical };
  }
  if (moving.horizontal) {
    edges.horizontal[0] = { guide: layerPos.y, offset: 0, snap: moving.horizontal };
  }

  const stops = buildGuideStops(levelBounds, objectBounds);
  const guides = findSnapGuides(stops, edges, referenceBox, levelBounds, threshold);

  let x = layerPos.x;
  let y = layerPos.y;
  for (const guide of guides) {
    if (guide.orientation === 'V') x = guide.lineGuide;
    if (guide.orientation === 'H') y = guide.lineGuide;
  }

  return { layerPos: { x, y }, guides };
}

export function resolveResizeSnapGuides({
  proposedBox,
  anchor,
  levelBounds,
  objectBounds,
  threshold = DEFAULT_SNAP_THRESHOLD,
  minSize = MIN_OBJECT_SIZE,
}: {
  proposedBox: BoundingBox;
  anchor: string;
  levelBounds: LevelBounds;
  objectBounds: BoundingBox[];
  threshold?: number;
  minSize?: number;
}): ResizeSnapGuideResult {
  const normalized = normalizeResizeBox(proposedBox);
  const moving = getMovingEdgesFromAnchor(anchor);

  if (!moving.vertical && !moving.horizontal) {
    return { guides: [], snappedBox: proposedBox };
  }

  const box = {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
  };

  const edges = buildSnappingEdgesForResize(box, moving);
  const stops = buildGuideStops(levelBounds, objectBounds);
  const guides = findSnapGuides(stops, edges, box, levelBounds, threshold);
  const snapped = applyResizeSnapGuides(box, guides, moving, anchor, minSize);
  const snappedBox = restoreResizeBoxSigns(snapped, normalized.flippedX, normalized.flippedY);

  return { guides, snappedBox };
}

/** Convenience for tests — same edge builder used during drag snap. */
export function buildFullSnappingEdgesFromRect(box: BoundingBox) {
  return buildSnappingEdgesFromRect(box, { x: box.x, y: box.y });
}

export { getFixedPointFromAnchor, getMovingEdgesFromAnchor, type MovingResizeEdges, type ResizeAnchor } from '../geometry/anchor.js';
