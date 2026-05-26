import {
  buildCorridorGroupResizeUpdates,
  buildCorridorGroupRotationUpdates,
  buildCorridorTransformSnapshot,
  computeCorridorResizeGeometry,
  createCorridorGroupTransformSession,
  getCorridorGroupBounds,
  normalizeRotation,
  resolveLiveCorridorGroupScale,
  snapshotToAabbBounds,
  type CorridorGroupBounds,
  type CorridorGroupTransformSession,
  type CorridorTransformSnapshot,
} from '@alusa/domain';
import { resolveResizeSnapGuides } from '@alusa/domain';
import type { BoundingBox, CorridorTransformGeometry, CorridorTransformPreviewPatch, LevelBounds } from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO } from '../../api/event-map-service';
import { applyCorridorNodeFromModel, buildCorridorGeometryAfterRotation, normalizeCorridorNodeAfterTransform, resolveCorridorTransformSession } from './corridor-canvas';
import { resolveCorridorResizeMode, shouldUseUniformGroupScale } from './corridor-resize-mode';
import type { CorridorResizeMode } from './corridor-resize-mode';

import type Konva from 'konva';

function snapCorridorGeometryAtCommit(
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

export type CorridorTransformToolSession = {
  mode: 'rotate' | 'resize';
  anchor: string;
  resizeMode: CorridorResizeMode;
  corridorIds: string[];
  snapshots: CorridorTransformSnapshot[];
  group: CorridorGroupTransformSession | null;
  /** Always 0 — transformer rotation is reset at session start. */
  initialTransformerRotation: number;
  /** Fixed-point bounds: union AABB for groups, per-item for single resize. */
  resizeBounds: CorridorGroupBounds;
  /** Corner multi-select → uniform scale; edge multi-select → per-axis group resize. */
  uniformGroupScale: boolean;
  baseCorridors: EventMapObjectDTO[];
};

export type CorridorTransformStageContext = {
  stage: Konva.Stage;
  transformer: Konva.Transformer;
};

export type CorridorSnapCommitContext = {
  levelBounds: LevelBounds | null;
  objectBounds: BoundingBox[];
  snapDisabled?: boolean;
};

function readNodeScale(node: Konva.Node) {
  return {
    scaleX: Math.abs(node.scaleX() || 1),
    scaleY: Math.abs(node.scaleY() || 1),
  };
}

/** Reset transformer wrapper rotation so deltas stay relative to the gesture. */
export function resetCorridorTransformer(transformer: Konva.Transformer) {
  transformer.rotation(0);
  transformer.forceUpdate();
}

export function beginCorridorTransformToolSession(
  baseMap: EventMapDTO,
  corridorIds: string[],
  transformer: Konva.Transformer,
  stage: Konva.Stage,
): CorridorTransformToolSession | null {
  const baseCorridors = corridorIds
    .map((id) => baseMap.objects.find((entry) => entry.id === id))
    .filter((object): object is EventMapObjectDTO => Boolean(object && object.type === 'CORRIDOR'));

  if (baseCorridors.length === 0) return null;

  const konvaSession = resolveCorridorTransformSession(transformer.getActiveAnchor() ?? '');
  const resizeMode = resolveCorridorResizeMode(konvaSession.anchor);
  const uniformGroupScale = shouldUseUniformGroupScale(konvaSession.anchor, baseCorridors.length);

  resetCorridorTransformer(transformer);

  const snapshots = baseCorridors.map((object) => buildCorridorTransformSnapshot(object));

  let initialBounds: CorridorGroupBounds | undefined;
  if (konvaSession.mode === 'resize') {
    initialBounds =
      baseCorridors.length === 1
        ? snapshotToAabbBounds(snapshots[0]!)
        : getCorridorGroupBounds(baseCorridors);
  }

  const group = createCorridorGroupTransformSession(
    baseCorridors,
    0,
    konvaSession.anchor,
    initialBounds,
  );

  const resizeBounds =
    baseCorridors.length === 1
      ? snapshotToAabbBounds(snapshots[0]!)
      : (group?.initialBounds ?? getCorridorGroupBounds(baseCorridors));

  return {
    mode: konvaSession.mode,
    anchor: konvaSession.anchor,
    resizeMode,
    corridorIds,
    snapshots,
    group,
    initialTransformerRotation: 0,
    resizeBounds,
    uniformGroupScale,
    baseCorridors,
  };
}

/**
 * Live preview — Konva only, no React state.
 *
 * Resize: no bake per frame (Konva keeps scale; avoids Transformer feedback loop / flicker).
 * Rotate single: Konva native rotation on node.
 * Rotate multi: orbit around group pivot (Transformer cannot do this alone).
 */
export function applyCorridorTransformLivePreview(
  session: CorridorTransformToolSession,
  ctx: CorridorTransformStageContext,
) {
  const { stage, transformer } = ctx;

  if (session.mode !== 'rotate' || session.snapshots.length < 2) {
    return;
  }

  const rotationDelta = transformer.rotation() - session.initialTransformerRotation;
  const pivot = session.group?.pivot ?? {
    centerX: session.snapshots[0]!.centerX,
    centerY: session.snapshots[0]!.centerY,
  };
  const updates = buildCorridorGroupRotationUpdates(session.snapshots, pivot, rotationDelta, {
    snap: false,
  });

  for (const update of updates) {
    const node = stage.findOne(`#node-${update.id}`);
    if (!node) continue;
    normalizeCorridorNodeAfterTransform(node, update.geometry);
  }
}

function buildResizeCommitPatches(
  session: CorridorTransformToolSession,
  stage: Konva.Stage,
  snap?: CorridorSnapCommitContext,
): CorridorTransformPreviewPatch[] {
  const patches: CorridorTransformPreviewPatch[] = [];

  if (session.uniformGroupScale && session.snapshots.length >= 2 && session.group) {
    const scale = resolveLiveCorridorGroupScale(session.snapshots, (objectId) => {
      const node = stage.findOne(`#node-${objectId}`);
      if (!node) return null;
      return readNodeScale(node);
    });
    const updates = buildCorridorGroupResizeUpdates(
      session.snapshots,
      session.group.initialBounds,
      session.anchor,
      scale,
    );

    for (const update of updates) {
      const node = stage.findOne(`#node-${update.id}`);
      if (!node) continue;
      normalizeCorridorNodeAfterTransform(node, update.geometry);
      if (
        ![update.geometry.x, update.geometry.y, update.geometry.width, update.geometry.height, update.geometry.rotation].every(
          Number.isFinite,
        )
      ) {
        continue;
      }
      patches.push({
        objectId: update.id,
        patch: update.geometry,
        mode: 'group-resize',
        anchor: session.anchor,
      });
    }
    return patches;
  }

  for (const snapshot of session.snapshots) {
    const node = stage.findOne(`#node-${snapshot.id}`);
    if (!node) continue;

    const scale = readNodeScale(node);
    const rawGeometry = computeCorridorResizeGeometry(
      snapshot,
      session.resizeBounds,
      session.anchor,
      scale,
      snapshotToAabbBounds(snapshot),
    );
    const geometry =
      snap?.levelBounds && session.mode === 'resize'
        ? snapCorridorGeometryAtCommit(
            { ...rawGeometry, rotation: node.rotation() },
            session.anchor,
            snap.levelBounds,
            snap.objectBounds,
            { snapDisabled: snap.snapDisabled },
          )
        : rawGeometry;

    const normalizedRotation = normalizeRotation(node.rotation());
    normalizeCorridorNodeAfterTransform(node, {
      ...geometry,
      rotation: normalizedRotation,
    });

    if (![geometry.x, geometry.y, geometry.width, geometry.height, normalizedRotation].every(Number.isFinite)) {
      continue;
    }

    patches.push({
      objectId: snapshot.id,
      patch: {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        rotation: normalizedRotation,
      },
      mode: session.snapshots.length >= 2 ? 'group-resize' : 'resize',
      anchor: session.anchor,
    });
  }

  return patches;
}

export function buildCorridorTransformCommitPatches(
  session: CorridorTransformToolSession,
  ctx: CorridorTransformStageContext,
  snap?: CorridorSnapCommitContext,
): CorridorTransformPreviewPatch[] {
  const { stage, transformer } = ctx;

  if (session.mode === 'rotate') {
    const patches: CorridorTransformPreviewPatch[] = [];
    const rotationDelta = transformer.rotation() - session.initialTransformerRotation;

    if (session.snapshots.length >= 2) {
      const pivot = session.group?.pivot ?? {
        centerX: session.snapshots[0]!.centerX,
        centerY: session.snapshots[0]!.centerY,
      };
      const updates = buildCorridorGroupRotationUpdates(session.snapshots, pivot, rotationDelta, {
        snap: false,
      });

      for (const update of updates) {
        const node = stage.findOne(`#node-${update.id}`);
        if (!node) continue;
        normalizeCorridorNodeAfterTransform(node, update.geometry);
        if (
          ![update.geometry.x, update.geometry.y, update.geometry.width, update.geometry.height, update.geometry.rotation].every(
            Number.isFinite,
          )
        ) {
          continue;
        }
        patches.push({
          objectId: update.id,
          patch: update.geometry,
          mode: 'group-rotate',
          anchor: session.anchor,
        });
      }
      return patches;
    }

    for (const snapshot of session.snapshots) {
      const node = stage.findOne(`#node-${snapshot.id}`);
      if (!node) continue;
      const baseObject = session.baseCorridors.find((entry) => entry.id === snapshot.id);
      if (!baseObject) continue;
      const rotation = normalizeRotation(node.rotation());
      const geometry = buildCorridorGeometryAfterRotation(baseObject, rotation, { snap: false });
      normalizeCorridorNodeAfterTransform(node, geometry);
      patches.push({
        objectId: snapshot.id,
        patch: geometry,
        mode: 'rotate',
        anchor: session.anchor,
      });
    }
    return patches;
  }

  return buildResizeCommitPatches(session, stage, snap);
}

/** Sync corridor nodes from committed map after transform session ends. */
export function syncCorridorSessionNodes(
  stage: Konva.Stage,
  objects: EventMapObjectDTO[],
  corridorIds: string[],
  levelId: string,
) {
  const ids = new Set(corridorIds);
  for (const object of objects) {
    if (object.levelId !== levelId || object.hidden || object.type !== 'CORRIDOR' || !ids.has(object.id)) {
      continue;
    }
    const node = stage.findOne(`#node-${object.id}`);
    if (node) applyCorridorNodeFromModel(node, object);
  }
}
