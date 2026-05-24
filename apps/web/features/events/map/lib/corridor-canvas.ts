import type Konva from 'konva';

import type { EventMapObjectDTO } from '../api/event-map-service';
import { eventMapObjectToCorridorPolygon, polygonBounds } from './corridor-domain-bridge';
import { buildCorridorTransformSnapshot } from './corridor-group-transform';
import {
  computeCorridorResizeGeometry,
} from './corridor-group-resize';
import type { ResizeAnchor } from './resize-snap-guides';
import type { BoundingBox } from './snap-guides';
import {
  applyCorridorRotationPreservingCenter,
  normalizeRotation,
  snapSmartCorridorRotation,
  type CorridorTransformGeometry,
} from './smart-corridor-layout';

const MIN_CORRIDOR_NODE_SIZE = 8;

export type CorridorTransformMode = 'rotate' | 'resize';

export type CorridorTransformSession = {
  mode: CorridorTransformMode;
  anchor: string;
};

export type CorridorTransformPatch = {
  patch: Partial<EventMapObjectDTO>;
  mode: CorridorTransformMode;
};

export type CorridorCanvasAppearance = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: number[];
};

const RESIZE_ANCHORS = new Set<string>([
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]);

export function isCorridorResizeAnchor(anchor: string): anchor is ResizeAnchor {
  return RESIZE_ANCHORS.has(anchor);
}

export function getCorridorCanvasAppearance(selected: boolean, isSiblingOfSelected: boolean): CorridorCanvasAppearance {
  if (selected) {
    return {
      fill: 'rgba(124, 58, 237, 0.06)',
      stroke: '#7c3aed',
      strokeWidth: 1.5,
      dash: [8, 6],
    };
  }

  if (isSiblingOfSelected) {
    return {
      fill: 'rgba(248, 250, 252, 0.92)',
      stroke: '#cbd5e1',
      strokeWidth: 1.5,
      dash: [4, 4],
    };
  }

  return {
    fill: '#f8fafc',
    stroke: '#cbd5e1',
    strokeWidth: 1.5,
    dash: [8, 6],
  };
}

function isKonvaGroup(node: Konva.Node): node is Konva.Group {
  return typeof (node as Konva.Group).findOne === 'function';
}

function syncCorridorBodySize(node: Konva.Node, width: number, height: number) {
  if (!isKonvaGroup(node)) return;
  const bodyRect = node.findOne('.corridor-body') as Konva.Rect | undefined;
  if (!bodyRect) return;
  bodyRect.width(width);
  bodyRect.height(height);
}

export function corridorObjectToBox(object: EventMapObjectDTO): BoundingBox {
  return {
    x: object.x,
    y: object.y,
    width: Math.max(MIN_CORRIDOR_NODE_SIZE, object.width ?? MIN_CORRIDOR_NODE_SIZE),
    height: Math.max(MIN_CORRIDOR_NODE_SIZE, object.height ?? MIN_CORRIDOR_NODE_SIZE),
  };
}

/** Read scaled body size from the live Konva node (not the frozen transform-start base). */
export function readCorridorNodeScaledSize(node: Konva.Node) {
  if (isKonvaGroup(node)) {
    const bodyRect = node.findOne('.corridor-body') as Konva.Rect | undefined;
    const baseWidth = bodyRect?.width() ?? MIN_CORRIDOR_NODE_SIZE;
    const baseHeight = bodyRect?.height() ?? MIN_CORRIDOR_NODE_SIZE;
    return {
      width: Math.max(MIN_CORRIDOR_NODE_SIZE, baseWidth * Math.abs(node.scaleX() || 1)),
      height: Math.max(MIN_CORRIDOR_NODE_SIZE, baseHeight * Math.abs(node.scaleY() || 1)),
    };
  }

  return {
    width: Math.max(MIN_CORRIDOR_NODE_SIZE, Math.abs(node.width() * (node.scaleX() || 1))),
    height: Math.max(MIN_CORRIDOR_NODE_SIZE, Math.abs(node.height() * (node.scaleY() || 1))),
  };
}

export function resolveCorridorTransformSession(activeAnchor: string): CorridorTransformSession {
  if (activeAnchor === 'rotater') {
    return { mode: 'rotate', anchor: activeAnchor };
  }

  return {
    mode: 'resize',
    anchor: isCorridorResizeAnchor(activeAnchor) ? activeAnchor : 'bottom-right',
  };
}

/** @deprecated Use resolveCorridorTransformSession */
export function resolveCorridorTransformMode(activeAnchor: string): CorridorTransformMode {
  return resolveCorridorTransformSession(activeAnchor).mode;
}

export function buildCorridorGeometryAfterResize(
  baseObject: EventMapObjectDTO,
  node: Konva.Node,
  anchor: string,
): CorridorTransformGeometry {
  const snapshot = buildCorridorTransformSnapshot(baseObject);
  const bounds = polygonBounds(eventMapObjectToCorridorPolygon(baseObject));
  const geometry = computeCorridorResizeGeometry(snapshot, bounds, anchor, {
    scaleX: Math.abs(node.scaleX() || 1),
    scaleY: Math.abs(node.scaleY() || 1),
  });

  return {
    ...geometry,
    rotation: snapSmartCorridorRotation(node.rotation()),
  };
}

/** Unified geometry entry point for corridor transform commit. */
export function computeCorridorTransformGeometry(
  baseObject: EventMapObjectDTO,
  node: Konva.Node,
  anchor: string,
): CorridorTransformGeometry {
  return buildCorridorGeometryAfterResize(baseObject, node, anchor);
}

export function buildCorridorGeometryAfterRotation(
  baseObject: EventMapObjectDTO,
  rotation: number,
  options?: { snap?: boolean },
): CorridorTransformGeometry {
  const draft: EventMapObjectDTO = {
    ...baseObject,
    data: { ...baseObject.data },
  };
  applyCorridorRotationPreservingCenter(draft, rotation, baseObject, options);
  return {
    x: draft.x,
    y: draft.y,
    width: Math.max(MIN_CORRIDOR_NODE_SIZE, draft.width ?? MIN_CORRIDOR_NODE_SIZE),
    height: Math.max(MIN_CORRIDOR_NODE_SIZE, draft.height ?? MIN_CORRIDOR_NODE_SIZE),
    rotation: draft.rotation ?? 0,
  };
}

/** @deprecated Use corridor-transform-session pipeline — kept for unit tests. */
export function applyLiveCorridorResizeToNode(
  node: Konva.Node,
  baseObject: EventMapObjectDTO,
  anchor: string,
) {
  const geometry = buildCorridorGeometryAfterResize(baseObject, node, anchor);
  normalizeCorridorNodeAfterTransform(node, geometry);
}

/** @deprecated Use corridor-transform-session pipeline — kept for unit tests. */
export function applyLiveCorridorRotationToNode(
  node: Konva.Node,
  baseObject: EventMapObjectDTO,
  rotation: number,
) {
  const geometry = buildCorridorGeometryAfterRotation(baseObject, rotation, { snap: false });
  normalizeCorridorNodeAfterTransform(node, geometry);
}

/** @deprecated Use buildCorridorTransformCommitPatches from corridor-transform-session. */
export function buildCorridorTransformCommitPatch(
  node: Konva.Node,
  baseObject: EventMapObjectDTO,
  session: Pick<CorridorTransformSession, 'mode' | 'anchor'>,
): CorridorTransformPatch {
  if (session.mode === 'rotate') {
    const rotation = snapSmartCorridorRotation(node.rotation());
    return { mode: 'rotate', patch: { rotation } };
  }

  const geometry = buildCorridorGeometryAfterResize(baseObject, node, session.anchor);
  return {
    mode: 'resize',
    patch: {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      rotation: geometry.rotation,
    },
  };
}

/** @deprecated Heuristic replaced by explicit session mode from transformer anchor. */
export function inferCorridorTransformMode(
  node: Konva.Node,
  baseObject: EventMapObjectDTO,
  explicitMode?: CorridorTransformMode | null,
): CorridorTransformMode {
  if (explicitMode) return explicitMode;

  const scaleX = Math.abs(node.scaleX() || 1);
  const scaleY = Math.abs(node.scaleY() || 1);
  const sizeChanged =
    Math.abs(scaleX - 1) > 0.001 ||
    Math.abs(scaleY - 1) > 0.001;

  if (sizeChanged) return 'resize';

  const rawRotation = normalizeRotation(node.rotation());
  const baseRotation = snapSmartCorridorRotation(baseObject.rotation ?? 0);
  if (Math.abs(snapSmartCorridorRotation(rawRotation) - baseRotation) > 0.001) {
    return 'rotate';
  }

  return 'resize';
}

/** Apply model geometry to the corridor Konva group (top-left pivot, Konva default). */
export function applyCorridorNodeFromModel(node: Konva.Node, object: EventMapObjectDTO) {
  const width = Math.max(MIN_CORRIDOR_NODE_SIZE, object.width ?? MIN_CORRIDOR_NODE_SIZE);
  const height = Math.max(MIN_CORRIDOR_NODE_SIZE, object.height ?? MIN_CORRIDOR_NODE_SIZE);
  const rotation = snapSmartCorridorRotation(object.rotation ?? 0);

  node.position({ x: object.x, y: object.y });
  node.rotation(rotation);
  node.offsetX(0);
  node.offsetY(0);
  node.scaleX(1);
  node.scaleY(1);
  syncCorridorBodySize(node, width, height);
}

/** Read corridor geometry after resize/rotate using anchor-aware fixed-point math. */
export function readCorridorPatchFromKonvaNode(
  node: Konva.Node,
  baseObject: EventMapObjectDTO,
  anchor = 'bottom-right',
): CorridorTransformGeometry {
  return buildCorridorGeometryAfterResize(baseObject, node, anchor);
}

/** Reset imperative Konva attrs after reading a transform (Konva docs pattern). */
export function normalizeCorridorNodeAfterTransform(
  node: Konva.Node,
  geometry: CorridorTransformGeometry,
) {
  node.scaleX(1);
  node.scaleY(1);
  node.offsetX(0);
  node.offsetY(0);
  node.position({ x: geometry.x, y: geometry.y });
  node.rotation(geometry.rotation);
  syncCorridorBodySize(node, geometry.width, geometry.height);
}

export function syncCorridorNodesFromMap(
  stage: Konva.Stage,
  objects: EventMapObjectDTO[],
  levelId: string,
  objectIds?: Set<string>,
) {
  for (const object of objects) {
    if (object.levelId !== levelId || object.hidden || object.type !== 'CORRIDOR') continue;
    if (objectIds && !objectIds.has(object.id)) continue;

    const node = stage.findOne(`#node-${object.id}`);
    if (!node) continue;
    applyCorridorNodeFromModel(node, object);
  }
}
