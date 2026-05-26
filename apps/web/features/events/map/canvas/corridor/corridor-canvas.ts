import {
  applyCorridorRotationPreservingCenter,
  buildCorridorTransformSnapshot,
  computeCorridorResizeGeometry,
  normalizeRotation,
  polygonBounds,
  eventMapObjectToCorridorPolygon,
  type CorridorTransformGeometry,
  type ResizeAnchor,
} from '@alusa/domain';
import type { EventMapObjectDTO } from '../../api/event-map-service';

import type Konva from 'konva';

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
    rotation: normalizeRotation(node.rotation()),
  };
}

/** Read corridor geometry after resize/rotate using anchor-aware fixed-point math. */
export function readCorridorPatchFromKonvaNode(
  node: Konva.Node,
  baseObject: EventMapObjectDTO,
  anchor = 'bottom-right',
): CorridorTransformGeometry {
  return buildCorridorGeometryAfterResize(baseObject, node, anchor);
}

/** Apply model geometry to the corridor Konva group (top-left pivot, Konva default). */
export function applyCorridorNodeFromModel(node: Konva.Node, object: EventMapObjectDTO) {
  const width = Math.max(MIN_CORRIDOR_NODE_SIZE, object.width ?? MIN_CORRIDOR_NODE_SIZE);
  const height = Math.max(MIN_CORRIDOR_NODE_SIZE, object.height ?? MIN_CORRIDOR_NODE_SIZE);
  const rotation = normalizeRotation(object.rotation ?? 0);

  node.position({ x: object.x, y: object.y });
  node.rotation(rotation);
  node.offsetX(0);
  node.offsetY(0);
  node.scaleX(1);
  node.scaleY(1);
  syncCorridorBodySize(node, width, height);
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

/** Build rotation geometry preserving corridor center (domain policy). */
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
