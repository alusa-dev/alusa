import {
  SNAP_TARGET_NAME,
  buildGuideStops,
  computeUnionBounds,
  isFiniteBoundingBox,
  resolveSnapGuides as resolveSnapGuidesFromGeometry,
  type BoundingBox,
  type CorridorPolygonPoint,
  type LayerSnapGeometry,
  type LevelBounds,
  type ResolveSnapGuidesOptions,
  type SnapGuideResult,
  type SnapGuideStops,
  type SnapGuideLine,
} from '@alusa/domain';
import type Konva from 'konva';

export function polygonToKonvaPoints(polygon: CorridorPolygonPoint[]): number[] {
  return polygon.flatMap((point) => [point.x, point.y]);
}

export type SnapGuideStopCacheEntry = {
  skipKey: string;
  stops: SnapGuideStops;
  objectBounds: BoundingBox[];
};

function toBoundingBox(rect: { x: number; y: number; width: number; height: number }): BoundingBox | null {
  const box = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
  return isFiniteBoundingBox(box) ? box : null;
}

export function getSnapLayer(node: Konva.Node): Konva.Layer | null {
  return node.getLayer() ?? null;
}

/** Bounds and anchor in map/layer coordinates, isolated from stage zoom/pan. */
export function getLayerSnapGeometry(node: Konva.Node): LayerSnapGeometry {
  const layer = getSnapLayer(node);
  const position = node.position();

  if (!layer) {
    const raw = node.getClientRect({ skipShadow: true, skipStroke: true });
    const box = toBoundingBox(raw) ?? {
      x: position.x,
      y: position.y,
      width: Math.max(0, node.width() * Math.abs(node.scaleX())),
      height: Math.max(0, node.height() * Math.abs(node.scaleY())),
    };
    return { box, anchor: position };
  }

  const raw = node.getClientRect({
    relativeTo: layer,
    skipShadow: true,
    skipStroke: true,
  });
  const box = toBoundingBox(raw) ?? {
    x: position.x,
    y: position.y,
    width: Math.max(0, node.width() * Math.abs(node.scaleX())),
    height: Math.max(0, node.height() * Math.abs(node.scaleY())),
  };
  return { box, anchor: node.getAbsolutePosition(layer) };
}

export function getNodeBounds(node: Konva.Node): BoundingBox {
  return getLayerSnapGeometry(node).box;
}

export function computeUnionBoundsFromNodes(nodes: Konva.Node[]): BoundingBox {
  return computeUnionBounds(nodes.map((node) => getNodeBounds(node)));
}

function normalizeSkipNodeIds(skipNodeIds: Set<string> | string | string[]) {
  if (typeof skipNodeIds === 'string') return new Set([skipNodeIds]);
  if (skipNodeIds instanceof Set) return skipNodeIds;
  return new Set(skipNodeIds);
}

export function collectSnapTargetBounds(
  contentLayer: Konva.Layer,
  skipNodeIds: Set<string> | string | string[],
): BoundingBox[] {
  const skip = normalizeSkipNodeIds(skipNodeIds);

  return contentLayer
    .find(`.${SNAP_TARGET_NAME}`)
    .filter((node) => !skip.has(node.id()) && node.visible())
    .map((node) =>
      toBoundingBox(
        node.getClientRect({
          relativeTo: contentLayer,
          skipShadow: true,
          skipStroke: true,
        }),
      ),
    )
    .filter((box): box is BoundingBox => box !== null);
}

export function createSnapGuideStopCache() {
  let entry: SnapGuideStopCacheEntry | null = null;

  return {
    get(contentLayer: Konva.Layer, skipIds: string[], levelBounds: LevelBounds): SnapGuideStopCacheEntry {
      const skipKey = [...skipIds].sort().join('|');
      if (entry?.skipKey === skipKey) {
        return entry;
      }

      const objectBounds = collectSnapTargetBounds(contentLayer, skipIds).filter(isFiniteBoundingBox);
      const stops = buildGuideStops(levelBounds, objectBounds);
      entry = { skipKey, stops, objectBounds };
      return entry;
    },
    invalidate() {
      entry = null;
    },
  };
}

export function applySnapDelta(nodes: Konva.Node[], delta: { x: number; y: number }) {
  if (!delta.x && !delta.y) return;

  for (const node of nodes) {
    node.x(node.x() + delta.x);
    node.y(node.y() + delta.y);
  }
}

export function applySnapGuides(node: Konva.Node, guides: SnapGuideLine[]) {
  if (!guides.length) return;

  const layer = getSnapLayer(node);
  if (!layer) return;

  let anchor = node.getAbsolutePosition(layer);
  for (const guide of guides) {
    if (guide.orientation === 'V') {
      anchor = { ...anchor, x: guide.lineGuide + guide.offset };
    } else {
      anchor = { ...anchor, y: guide.lineGuide + guide.offset };
    }
  }

  const current = node.getAbsolutePosition(layer);
  node.position({
    x: node.x() + (anchor.x - current.x),
    y: node.y() + (anchor.y - current.y),
  });
}

export function applySnapResult(nodes: Konva.Node[], result: SnapGuideResult) {
  if (nodes.length === 0) return;

  const hasDelta = result.snapDelta.x !== 0 || result.snapDelta.y !== 0;
  if (!result.guides.length && !hasDelta) return;

  if (nodes.length === 1) {
    const node = nodes[0]!;
    const rotated = Math.abs(node.rotation()) > 0.01;

    if (result.guides.length > 0 && rotated) {
      applySnapGuides(node, result.guides);
      const spacingDelta = {
        x: result.guides.some((guide) => guide.orientation === 'V') ? 0 : result.snapDelta.x,
        y: result.guides.some((guide) => guide.orientation === 'H') ? 0 : result.snapDelta.y,
      };
      if (spacingDelta.x || spacingDelta.y) {
        applySnapDelta(nodes, spacingDelta);
      }
      return;
    }

    if (hasDelta) {
      applySnapDelta(nodes, result.snapDelta);
      return;
    }

    applySnapGuides(node, result.guides);
    return;
  }

  applySnapDelta(nodes, result.snapDelta);
}

export function resolveSnapGuides(
  target: Konva.Node | Konva.Node[],
  levelBounds: LevelBounds,
  thresholdOrOptions: number | ResolveSnapGuidesOptions,
): SnapGuideResult {
  const nodes = Array.isArray(target) ? target : [target];
  const options = typeof thresholdOrOptions === 'number' ? { threshold: thresholdOrOptions } : thresholdOrOptions;
  const targetKind =
    options.targetKind ?? (nodes.length > 1 ? 'multi' : 'single');
  const firstNode = nodes[0];
  if (!firstNode) {
    return { guides: [], spacingGuides: [], snapDelta: { x: 0, y: 0 } };
  }
  const groupBox = nodes.length > 1 ? computeUnionBoundsFromNodes(nodes) : null;
  const geometry =
    nodes.length === 1
      ? getLayerSnapGeometry(firstNode)
      : { box: groupBox!, anchor: { x: groupBox!.x, y: groupBox!.y } };
  const layer = getSnapLayer(firstNode);
  const objectBounds =
    options.objectBounds ??
    (layer ? collectSnapTargetBounds(layer, nodes.map((node) => node.id())) : []);

  return resolveSnapGuidesFromGeometry(geometry, levelBounds, {
    ...options,
    objectBounds,
    targetKind,
  });
}
