import type Konva from 'konva';

import { resolveActiveGuideVisuals } from './snap-guide-visuals';
import { findSpacingSnaps, mergeSnapDeltas, type SpacingGuideVisual } from './spacing-guides';

export const SNAP_TARGET_NAME = 'snap-target';
export const DEFAULT_SNAP_THRESHOLD = 8;
export const DEFAULT_SNAP_RELEASE_THRESHOLD = 12;
export const MIN_SNAP_ZOOM = 0.25;
export const SNAP_GUIDE_COLOR = '#0ea5e9';
export const SNAP_GUIDE_SPAN_PADDING = 4;

/** Layer-space threshold — ~8 screen px feel constant across zoom (Konva resize snap pattern). */
/** Alt disables snap — works with Konva drag events and native mouse events from anchorDragBoundFunc. */
export function isSnapModifierActive(event?: unknown) {
  if (!event || typeof event !== 'object') return false;
  if ('altKey' in event && typeof (event as MouseEvent).altKey === 'boolean') {
    return (event as MouseEvent).altKey;
  }
  if ('evt' in event) {
    const nested = (event as { evt?: MouseEvent }).evt;
    return Boolean(nested?.altKey);
  }
  return false;
}

export function getSnapThreshold(zoom = 1) {
  return DEFAULT_SNAP_THRESHOLD / Math.max(zoom, MIN_SNAP_ZOOM);
}

export function getSnapReleaseThreshold(zoom = 1) {
  return DEFAULT_SNAP_RELEASE_THRESHOLD / Math.max(zoom, MIN_SNAP_ZOOM);
}

export function isFiniteBoundingBox(box: BoundingBox) {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

export type LevelBounds = {
  width: number;
  height: number;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SnapEdge = 'start' | 'center' | 'end';

export type SnapGuideLine = {
  lineGuide: number;
  offset: number;
  orientation: 'V' | 'H';
  snap: SnapEdge;
  span: { start: number; end: number };
  source: 'page' | 'object';
};

export type SnapTargetKind = 'single' | 'multi';

export type GuideStopEntry = {
  value: number;
  source: 'page' | 'object';
  edge: SnapEdge;
  referenceBox?: BoundingBox;
};

export type SnapGuideStops = {
  vertical: GuideStopEntry[];
  horizontal: GuideStopEntry[];
};

export type SnappingEdge = {
  guide: number;
  offset: number;
  snap: SnapEdge;
};

export type SnappingEdges = {
  vertical: SnappingEdge[];
  horizontal: SnappingEdge[];
};

export type LayerSnapGeometry = {
  box: BoundingBox;
  anchor: { x: number; y: number };
};

function clampSpan(start: number, end: number, min: number, max: number) {
  return {
    start: Math.max(min, Math.min(start, end)),
    end: Math.min(max, Math.max(start, end)),
  };
}

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
  const layer = node.getLayer();
  return layer ?? null;
}

/** Bounds and anchor in map/layer coordinates (immune to stage zoom/pan). */
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
  const anchor = node.getAbsolutePosition(layer);
  return { box, anchor };
}

export function getNodeBounds(node: Konva.Node): BoundingBox {
  return getLayerSnapGeometry(node).box;
}

function pushStop(
  entries: GuideStopEntry[],
  value: number,
  source: GuideStopEntry['source'],
  edge: SnapEdge,
  referenceBox?: BoundingBox,
) {
  const rounded = Math.round(value * 100) / 100;
  const exists = entries.some(
    (entry) =>
      Math.abs(entry.value - rounded) < 0.01 &&
      entry.source === source &&
      entry.edge === edge &&
      entry.referenceBox === referenceBox,
  );
  if (!exists) {
    entries.push({ value: rounded, source, edge, referenceBox });
  }
}

export function buildGuideStops(levelBounds: LevelBounds, objectBounds: BoundingBox[]): SnapGuideStops {
  const vertical: GuideStopEntry[] = [];
  const horizontal: GuideStopEntry[] = [];

  pushStop(vertical, 0, 'page', 'start');
  pushStop(vertical, levelBounds.width / 2, 'page', 'center');
  pushStop(vertical, levelBounds.width, 'page', 'end');
  pushStop(horizontal, 0, 'page', 'start');
  pushStop(horizontal, levelBounds.height / 2, 'page', 'center');
  pushStop(horizontal, levelBounds.height, 'page', 'end');

  for (const box of objectBounds) {
    pushStop(vertical, box.x, 'object', 'start', box);
    pushStop(vertical, box.x + box.width / 2, 'object', 'center', box);
    pushStop(vertical, box.x + box.width, 'object', 'end', box);
    pushStop(horizontal, box.y, 'object', 'start', box);
    pushStop(horizontal, box.y + box.height / 2, 'object', 'center', box);
    pushStop(horizontal, box.y + box.height, 'object', 'end', box);
  }

  return { vertical, horizontal };
}

export function buildSnappingEdgesFromRect(box: BoundingBox, anchor: { x: number; y: number }): SnappingEdges {
  return {
    vertical: [
      {
        guide: box.x,
        offset: anchor.x - box.x,
        snap: 'start',
      },
      {
        guide: box.x + box.width / 2,
        offset: anchor.x - (box.x + box.width / 2),
        snap: 'center',
      },
      {
        guide: box.x + box.width,
        offset: anchor.x - (box.x + box.width),
        snap: 'end',
      },
    ],
    horizontal: [
      {
        guide: box.y,
        offset: anchor.y - box.y,
        snap: 'start',
      },
      {
        guide: box.y + box.height / 2,
        offset: anchor.y - (box.y + box.height / 2),
        snap: 'center',
      },
      {
        guide: box.y + box.height,
        offset: anchor.y - (box.y + box.height),
        snap: 'end',
      },
    ],
  };
}

export function buildSnappingEdges(node: Konva.Node): SnappingEdges {
  const { box, anchor } = getLayerSnapGeometry(node);
  return buildSnappingEdgesFromRect(box, anchor);
}

function snapRank(match: { source: 'page' | 'object'; snap: SnapEdge }, targetKind: SnapTargetKind) {
  if (targetKind === 'multi') {
    if (match.source === 'page' && match.snap === 'center') return 0;
    if (match.source === 'page') return 1;
    if (match.source === 'object') return 2;
  }

  if (match.source === 'object') return 0;
  if (match.source === 'page' && match.snap === 'center') return 1;
  return 2;
}

function compareMatches<T extends { diff: number; source: 'page' | 'object'; snap: SnapEdge }>(
  a: T,
  b: T,
  targetKind: SnapTargetKind,
) {
  if (targetKind === 'multi') {
    const scoreA = a.diff + snapRank(a, targetKind);
    const scoreB = b.diff + snapRank(b, targetKind);
    if (Math.abs(scoreA - scoreB) > 0.001) return scoreA - scoreB;
  } else if (Math.abs(a.diff - b.diff) > 0.001) {
    return a.diff - b.diff;
  }

  const rankDiff = snapRank(a, targetKind) - snapRank(b, targetKind);
  if (rankDiff !== 0) return rankDiff;
  return 0;
}

function pickClosestMatch<T extends { diff: number; source: 'page' | 'object'; snap: SnapEdge }>(
  matches: T[],
  targetKind: SnapTargetKind,
) {
  let best: T | undefined;
  for (const match of matches) {
    if (!best || compareMatches(match, best, targetKind) < 0) {
      best = match;
    }
  }
  return best;
}

export function computeGuideSpan(
  orientation: 'V' | 'H',
  draggedBox: BoundingBox,
  referenceBox: BoundingBox | undefined,
  levelBounds: LevelBounds,
  source: 'page' | 'object',
): { start: number; end: number } {
  const padding = SNAP_GUIDE_SPAN_PADDING;

  if (orientation === 'V') {
    if (source === 'page' || !referenceBox) {
      return { start: 0, end: levelBounds.height };
    }

    const start = Math.min(draggedBox.y, referenceBox.y) - padding;
    const end = Math.max(draggedBox.y + draggedBox.height, referenceBox.y + referenceBox.height) + padding;
    return clampSpan(start, end, 0, levelBounds.height);
  }

  if (source === 'page' || !referenceBox) {
    return { start: 0, end: levelBounds.width };
  }

  const start = Math.min(draggedBox.x, referenceBox.x) - padding;
  const end = Math.max(draggedBox.x + draggedBox.width, referenceBox.x + referenceBox.width) + padding;
  return clampSpan(start, end, 0, levelBounds.width);
}

export function findSnapGuides(
  stops: SnapGuideStops,
  edges: SnappingEdges,
  draggedBox: BoundingBox,
  levelBounds: LevelBounds,
  threshold = DEFAULT_SNAP_THRESHOLD,
  targetKind: SnapTargetKind = 'single',
): SnapGuideLine[] {
  type Match = SnapGuideLine & { diff: number };

  const verticalMatches: Match[] = [];
  const horizontalMatches: Match[] = [];

  for (const stop of stops.vertical) {
    for (const edge of edges.vertical) {
      const diff = Math.abs(stop.value - edge.guide);
      if (diff < threshold) {
        verticalMatches.push({
          lineGuide: stop.value,
          diff,
          snap: edge.snap,
          offset: edge.offset,
          orientation: 'V',
          source: stop.source,
          span: computeGuideSpan('V', draggedBox, stop.referenceBox, levelBounds, stop.source),
        });
      }
    }
  }

  for (const stop of stops.horizontal) {
    for (const edge of edges.horizontal) {
      const diff = Math.abs(stop.value - edge.guide);
      if (diff < threshold) {
        horizontalMatches.push({
          lineGuide: stop.value,
          diff,
          snap: edge.snap,
          offset: edge.offset,
          orientation: 'H',
          source: stop.source,
          span: computeGuideSpan('H', draggedBox, stop.referenceBox, levelBounds, stop.source),
        });
      }
    }
  }

  const guides: SnapGuideLine[] = [];
  const closestVertical = pickClosestMatch(verticalMatches, targetKind);
  const closestHorizontal = pickClosestMatch(horizontalMatches, targetKind);

  if (closestVertical) {
    guides.push({
      lineGuide: closestVertical.lineGuide,
      offset: closestVertical.offset,
      orientation: closestVertical.orientation,
      snap: closestVertical.snap,
      span: closestVertical.span,
      source: closestVertical.source,
    });
  }

  if (closestHorizontal) {
    guides.push({
      lineGuide: closestHorizontal.lineGuide,
      offset: closestHorizontal.offset,
      orientation: closestHorizontal.orientation,
      snap: closestHorizontal.snap,
      span: closestHorizontal.span,
      source: closestHorizontal.source,
    });
  }

  return guides;
}

export function computeUnionBounds(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function computeUnionBoundsFromNodes(nodes: Konva.Node[]): BoundingBox {
  return computeUnionBounds(nodes.map((node) => getNodeBounds(node)));
}

export function getBoxEdge(box: BoundingBox, orientation: 'V' | 'H', snap: SnapEdge) {
  if (orientation === 'V') {
    if (snap === 'start') return box.x;
    if (snap === 'center') return box.x + box.width / 2;
    return box.x + box.width;
  }

  if (snap === 'start') return box.y;
  if (snap === 'center') return box.y + box.height / 2;
  return box.y + box.height;
}

export type SnapGuideResult = {
  guides: SnapGuideLine[];
  spacingGuides: SpacingGuideVisual[];
  snapDelta: { x: number; y: number };
};

export function computeSnapDelta(guides: SnapGuideLine[], box: BoundingBox) {
  let x = 0;
  let y = 0;

  for (const guide of guides) {
    if (guide.orientation === 'V') {
      x = guide.lineGuide - getBoxEdge(box, 'V', guide.snap);
    } else {
      y = guide.lineGuide - getBoxEdge(box, 'H', guide.snap);
    }
  }

  return { x, y };
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
    const node = nodes[0];
    const rotated = Math.abs(node.rotation()) > 0.01;

    // Anchor-based apply keeps rotated objects aligned to visual edges.
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

export type ResolveSnapGuidesOptions = {
  stops?: SnapGuideStops;
  objectBounds?: BoundingBox[];
  snapDisabled?: boolean;
  threshold?: number;
  targetKind?: SnapTargetKind;
};

export function resolveSnapGuides(
  target: Konva.Node | Konva.Node[],
  levelBounds: LevelBounds,
  thresholdOrOptions: number | ResolveSnapGuidesOptions = DEFAULT_SNAP_THRESHOLD,
): SnapGuideResult {
  const options: ResolveSnapGuidesOptions =
    typeof thresholdOrOptions === 'number' ? { threshold: thresholdOrOptions } : thresholdOrOptions;
  const threshold = options.threshold ?? DEFAULT_SNAP_THRESHOLD;
  const targetKind = options.targetKind ?? (Array.isArray(target) && target.length > 1 ? 'multi' : 'single');

  if (options.snapDisabled) {
    return { guides: [], spacingGuides: [], snapDelta: { x: 0, y: 0 } };
  }

  const nodes = Array.isArray(target) ? target : [target];
  const contentLayer = nodes[0] ? getSnapLayer(nodes[0]) : null;
  if (!contentLayer || nodes.length === 0) {
    return { guides: [], spacingGuides: [], snapDelta: { x: 0, y: 0 } };
  }

  const skipIds = nodes.map((node) => node.id());
  const draggedBox = nodes.length === 1 ? getNodeBounds(nodes[0]) : computeUnionBoundsFromNodes(nodes);
  if (!isFiniteBoundingBox(draggedBox)) {
    return { guides: [], spacingGuides: [], snapDelta: { x: 0, y: 0 } };
  }

  const objectBounds =
    options.objectBounds ??
    collectSnapTargetBounds(contentLayer, skipIds).filter(isFiniteBoundingBox);
  const stops = options.stops ?? buildGuideStops(levelBounds, objectBounds);
  const anchor =
    nodes.length === 1
      ? getLayerSnapGeometry(nodes[0]).anchor
      : { x: draggedBox.x, y: draggedBox.y };
  const edges = buildSnappingEdgesFromRect(draggedBox, anchor);
  const guides = findSnapGuides(stops, edges, draggedBox, levelBounds, threshold, targetKind);
  const edgeDelta = computeSnapDelta(guides, draggedBox);
  const spacing = findSpacingSnaps(draggedBox, objectBounds, threshold);

  const hasEdgeX = guides.some((guide) => guide.orientation === 'V');
  const hasEdgeY = guides.some((guide) => guide.orientation === 'H');
  const hasPageEdgeX = guides.some((guide) => guide.orientation === 'V' && guide.source === 'page');
  const hasPageEdgeY = guides.some((guide) => guide.orientation === 'H' && guide.source === 'page');
  const edgeDiffX = hasEdgeX ? Math.abs(edgeDelta.x) : Number.POSITIVE_INFINITY;
  const edgeDiffY = hasEdgeY ? Math.abs(edgeDelta.y) : Number.POSITIVE_INFINITY;
  const spacingDiffX =
    targetKind === 'multi' && hasPageEdgeX && spacing.diffX > edgeDiffX - 3
      ? Number.POSITIVE_INFINITY
      : spacing.diffX;
  const spacingDiffY =
    targetKind === 'multi' && hasPageEdgeY && spacing.diffY > edgeDiffY - 3
      ? Number.POSITIVE_INFINITY
      : spacing.diffY;

  const snapDelta = mergeSnapDeltas(edgeDelta, { x: spacing.deltaX, y: spacing.deltaY }, { x: edgeDiffX, y: edgeDiffY }, { x: spacingDiffX, y: spacingDiffY });

  const { guides: activeEdgeGuides, spacingGuides: activeSpacingGuides } = resolveActiveGuideVisuals(
    guides,
    { ...spacing, diffX: spacingDiffX, diffY: spacingDiffY },
    edgeDiffX,
    edgeDiffY,
    threshold,
  );

  return {
    guides: activeEdgeGuides,
    spacingGuides: activeSpacingGuides,
    snapDelta,
  };
}
