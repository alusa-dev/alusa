import {
  MIN_OBJECT_SIZE,
  MIN_UNIFORM_SCALE,
  buildUniformTransformUpdates,
  clampObjectSize,
  clampFontSize,
  clampUniformScale,
  computeUniformTransformPatch,
  getObjectTransformSnapshot,
  getSnapshotsUnionBounds,
  resolveLiveUniformScale,
  type EventMapDTO,
  type ObjectTransformSnapshot,
} from '@alusa/domain';
import Konva from 'konva';

export type TransformNodeSnapshot = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  bodyWidth?: number;
  bodyHeight?: number;
};

export type ObjectTransformSession = {
  snapshots: Map<string, ObjectTransformSnapshot>;
  initialBounds: ReturnType<typeof getSnapshotsUnionBounds>;
  initialRotation: number;
  /** When true, corridors are excluded from the session (generic mixed selection). */
  excludeCorridors: boolean;
};

export function resetNodeScale(node: Konva.Node) {
  node.scaleX(1);
  node.scaleY(1);
}

export function readNodeScale(node: Konva.Node) {
  return {
    scaleX: node.scaleX(),
    scaleY: node.scaleY(),
  };
}

export function readTransformerRotationDelta(transformer: Konva.Transformer, initialRotation: number) {
  return transformer.rotation() - initialRotation;
}

export function captureTransformNodeSnapshots(stage: Konva.Stage, nodeIds: string[]): TransformNodeSnapshot[] {
  const snapshots: TransformNodeSnapshot[] = [];

  for (const nodeId of nodeIds) {
    const node = stage.findOne(`#${nodeId}`);
    if (!node) continue;

    const container = node as Konva.Container;
    const body = container.findOne('.corridor-body') as Konva.Rect | undefined;
    snapshots.push({
      id: nodeId,
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      bodyWidth: body?.width(),
      bodyHeight: body?.height(),
    });
  }

  return snapshots;
}

export function restoreTransformNodeSnapshots(stage: Konva.Stage, snapshots: TransformNodeSnapshot[]) {
  for (const snapshot of snapshots) {
    const node = stage.findOne(`#${snapshot.id}`);
    if (!node) continue;

    node.position({ x: snapshot.x, y: snapshot.y });
    node.rotation(snapshot.rotation);
    node.scaleX(snapshot.scaleX);
    node.scaleY(snapshot.scaleY);

    const container = node as Konva.Container;
    const body = container.findOne('.corridor-body') as Konva.Rect | undefined;
    if (body && typeof snapshot.bodyWidth === 'number' && typeof snapshot.bodyHeight === 'number') {
      body.width(snapshot.bodyWidth);
      body.height(snapshot.bodyHeight);
    }
  }
}

export function beginObjectTransformSession(
  map: EventMapDTO,
  selectedObjectIds: string[],
  stage: Konva.Stage,
  transformer: Konva.Transformer,
  options?: { excludeCorridors?: boolean },
): ObjectTransformSession | null {
  const excludeCorridors = options?.excludeCorridors ?? false;
  const snapshots = new Map<string, ObjectTransformSnapshot>();

  for (const objectId of selectedObjectIds) {
    const object = map.objects.find((entry) => entry.id === objectId);
    if (!object || (excludeCorridors && object.type === 'CORRIDOR')) continue;
    snapshots.set(objectId, getObjectTransformSnapshot(object));

    const node = stage.findOne(`#node-${objectId}`);
    if (node) resetNodeScale(node);
  }

  if (snapshots.size === 0) return null;

  return {
    snapshots,
    initialBounds: getSnapshotsUnionBounds([...snapshots.values()]),
    initialRotation: transformer.rotation(),
    excludeCorridors,
  };
}

export function applyObjectTransformLivePreview({
  session,
  stage,
  transformer,
  scale,
}: {
  session: ObjectTransformSession;
  stage: Konva.Stage;
  transformer: Konva.Transformer;
  scale: number;
}) {
  const rotationDelta = readTransformerRotationDelta(transformer, session.initialRotation);
  const updates = buildUniformTransformUpdates(
    session.snapshots,
    session.initialBounds.centerX,
    session.initialBounds.centerY,
    scale,
    rotationDelta,
  );

  for (const entry of updates) {
    const snapshot = session.snapshots.get(entry.id);
    const node = stage.findOne(`#node-${entry.id}`);
    if (!snapshot || !node) continue;

    node.x(entry.patch.x);
    node.y(entry.patch.y);
    node.rotation(entry.patch.rotation ?? 0);

    if (node instanceof Konva.Text) {
      resetNodeScale(node);
      if (snapshot.textMode === 'multiline' && typeof entry.patch.width === 'number') {
        node.width(entry.patch.width);
        node.wrap('word');
      } else {
        node.width(undefined);
        node.wrap('none');
      }
      const fontSize = entry.patch.data?.fontSize;
      if (typeof fontSize === 'number') node.fontSize(fontSize);
      continue;
    }

    node.scaleX(scale);
    node.scaleY(scale);
  }
}

export function resolveLiveObjectTransformScale(
  session: ObjectTransformSession,
  getNodeScale: (objectId: string) => { scaleX: number; scaleY: number } | null,
) {
  if (session.excludeCorridors) {
    let maxScale = 1;
    for (const objectId of session.snapshots.keys()) {
      const scale = getNodeScale(objectId);
      if (!scale) continue;
      const sx = Math.abs(scale.scaleX);
      const sy = Math.abs(scale.scaleY);
      if (sx > MIN_UNIFORM_SCALE || sy > MIN_UNIFORM_SCALE) {
        maxScale = Math.max(maxScale, clampUniformScale(Math.max(sx, sy)));
      }
    }
    return maxScale;
  }

  return resolveLiveUniformScale(session.snapshots, getNodeScale);
}

export function readObjectTransformCommitFromNodes(
  stage: Konva.Stage,
  session: ObjectTransformSession,
  selectedIds?: string[],
) {
  const objectIds = selectedIds ?? [...session.snapshots.keys()];
  const updates: Array<{ id: string; patch: ReturnType<typeof computeUniformTransformPatch> }> = [];

  for (const objectId of objectIds) {
    const snapshot = session.snapshots.get(objectId);
    const node = stage.findOne(`#node-${objectId}`);
    if (!snapshot || !node) continue;

    if (snapshot.type === 'TEXT') {
      const textNode = node as Konva.Text;
      const fontSize = clampFontSize(textNode.fontSize());
      updates.push({
        id: objectId,
        patch: {
          x: textNode.x(),
          y: textNode.y(),
          rotation: textNode.rotation(),
          width:
            snapshot.textMode === 'multiline' && textNode.width() > 0
              ? clampObjectSize(textNode.width())
              : null,
          height:
            snapshot.textMode === 'multiline' && textNode.height() > 0
              ? clampObjectSize(textNode.height())
              : null,
          data: { fontSize },
        },
      });
      continue;
    }

    const scale = clampUniformScale(Math.max(Math.abs(node.scaleX()), Math.abs(node.scaleY()), MIN_UNIFORM_SCALE));
    resetNodeScale(node);
    updates.push({
      id: objectId,
      patch: {
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        width: clampObjectSize(snapshot.width * scale),
        height: clampObjectSize(snapshot.height * scale),
      },
    });
  }

  return updates;
}

export function readSeatTransformFromNode(node: Konva.Node, baseSize = 24) {
  const scale = Math.max(Math.abs(node.scaleX() || 1), Math.abs(node.scaleY() || 1));
  resetNodeScale(node);
  const x = node.x();
  const y = node.y();
  const size = Math.max(MIN_OBJECT_SIZE, baseSize * scale);
  const rotation = node.rotation();
  if (![x, y, size, rotation].every(Number.isFinite)) return null;
  return { x, y, size, rotation };
}

export function readSeatGroupTransformFromNode(
  node: Konva.Node,
  group: {
    seatWidth: number;
    seatHeight: number;
    gapX: number;
    gapY: number;
    paddingLeft: number;
    paddingRight: number;
    paddingTop: number;
    paddingBottom: number;
  },
) {
  const scaleX = Math.abs(node.scaleX() || 1);
  const scaleY = Math.abs(node.scaleY() || 1);
  const x = node.x();
  const y = node.y();
  const rotation = node.rotation();
  resetNodeScale(node);
  if (![x, y, rotation, scaleX, scaleY].every(Number.isFinite)) return null;
  return {
    x,
    y,
    rotation,
    seatWidth: Math.max(MIN_OBJECT_SIZE, group.seatWidth * scaleX),
    seatHeight: Math.max(MIN_OBJECT_SIZE, group.seatHeight * scaleY),
    gapX: Math.max(0, group.gapX * scaleX),
    gapY: Math.max(0, group.gapY * scaleY),
    paddingLeft: Math.max(0, group.paddingLeft * scaleX),
    paddingRight: Math.max(0, group.paddingRight * scaleX),
    paddingTop: Math.max(0, group.paddingTop * scaleY),
    paddingBottom: Math.max(0, group.paddingBottom * scaleY),
  };
}

export function readScaledShapeTransformFromNode(
  node: Konva.Node,
  baseWidth: number,
  baseHeight: number,
) {
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    resetNodeScale(node);
    return null;
  }
  resetNodeScale(node);
  const x = node.x();
  const y = node.y();
  const width = Math.max(MIN_OBJECT_SIZE, baseWidth * scaleX);
  const height = Math.max(MIN_OBJECT_SIZE, baseHeight * scaleY);
  const rotation = node.rotation();
  if (![x, y, width, height, rotation].every(Number.isFinite)) return null;
  return { x, y, width, height, rotation };
}
