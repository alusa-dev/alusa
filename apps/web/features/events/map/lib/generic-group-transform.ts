import type Konva from 'konva';

import type { EventMapDTO } from '../api/event-map-service';
import {
  buildUniformTransformUpdates,
  clampObjectSize,
  clampUniformScale,
  getObjectTransformSnapshot,
  getSnapshotsUnionBounds,
  MIN_UNIFORM_SCALE,
  type ObjectTransformSnapshot,
} from './uniform-group-transform';

export type GenericTransformSession = {
  snapshots: Map<string, ObjectTransformSnapshot>;
  initialBounds: ReturnType<typeof getSnapshotsUnionBounds>;
  initialRotation: number;
};

export function beginGenericTransformSession(
  map: EventMapDTO,
  selectedObjectIds: string[],
  stage: Konva.Stage,
  transformer: Konva.Transformer,
): GenericTransformSession | null {
  const snapshots = new Map<string, ObjectTransformSnapshot>();

  for (const objectId of selectedObjectIds) {
    const object = map.objects.find((entry) => entry.id === objectId);
    if (!object || object.type === 'CORRIDOR') continue;
    snapshots.set(objectId, getObjectTransformSnapshot(object));

    const node = stage.findOne(`#node-${objectId}`);
    if (node) {
      node.scaleX(1);
      node.scaleY(1);
    }
  }

  if (snapshots.size === 0) return null;

  return {
    snapshots,
    initialBounds: getSnapshotsUnionBounds([...snapshots.values()]),
    initialRotation: transformer.rotation(),
  };
}

export function applyGenericGroupTransform({
  session,
  stage,
  transformer,
  scale,
}: {
  session: GenericTransformSession;
  stage: Konva.Stage;
  transformer: Konva.Transformer;
  scale: number;
}) {
  const rotationDelta = transformer.rotation() - session.initialRotation;
  const updates = buildUniformTransformUpdates(
    session.snapshots,
    session.initialBounds.centerX,
    session.initialBounds.centerY,
    scale,
    rotationDelta,
  );

  for (const entry of updates) {
    const node = stage.findOne(`#node-${entry.id}`);
    if (!node) continue;

    node.x(entry.patch.x);
    node.y(entry.patch.y);
    node.rotation(entry.patch.rotation ?? 0);
    node.scaleX(scale);
    node.scaleY(scale);
  }
}

export function readGenericTransformCommitFromNodes(
  stage: Konva.Stage,
  session: GenericTransformSession,
) {
  const updates: Array<{ id: string; patch: { x: number; y: number; width: number; height: number; rotation: number } }> = [];

  for (const [objectId, snapshot] of session.snapshots) {
    const node = stage.findOne(`#node-${objectId}`);
    if (!node) continue;

    const scale = clampUniformScale(Math.max(Math.abs(node.scaleX()), Math.abs(node.scaleY()), MIN_UNIFORM_SCALE));
    node.scaleX(1);
    node.scaleY(1);

    updates.push({
      id: objectId,
      patch: {
        x: node.x(),
        y: node.y(),
        width: clampObjectSize(snapshot.width * scale),
        height: clampObjectSize(snapshot.height * scale),
        rotation: node.rotation(),
      },
    });
  }

  return updates;
}

export function resolveLiveGenericScale(
  session: GenericTransformSession,
  getNodeScale: (objectId: string) => { scaleX: number; scaleY: number } | null,
) {
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
