import {
  MIN_OBJECT_SIZE,
  computeUniformTransformPatch,
  getObjectBounds,
  getSeatGroupTightBounds,
  getSnapshotsUnionBounds,
  resolveLiveUniformScale,
} from '@alusa/domain';
import type { CorridorTransformPreviewPatch, ObjectTransformSnapshot } from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../../api/event-map-service';
import {
  applyObjectTransformLivePreview,
  beginObjectTransformSession,
  readObjectTransformCommitFromNodes,
  readSeatGroupTransformFromNode,
  readSeatTransformFromNode,
  resolveLiveObjectTransformScale,
  resetNodeScale,
  type ObjectTransformSession,
} from '../adapters/konva-transform-adapter';
import { applyCorridorTransformLivePreview, beginCorridorTransformToolSession, buildCorridorTransformCommitPatches, resetCorridorTransformer } from '../corridor/corridor-transform-session';
import type { CorridorSnapCommitContext, CorridorTransformStageContext, CorridorTransformToolSession } from '../corridor/corridor-transform-session';

import Konva from 'konva';

import type { MapTransformSessionKind } from './transform-routing';

export type UniformTransformSession = ObjectTransformSession;

export type MapTransformSession = {
  kind: MapTransformSessionKind;
  corridor: CorridorTransformToolSession | null;
  objectTransform: ObjectTransformSession | null;
  seatGroupTransform: SeatGroupTransformSession | null;
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  selectedSeatGroupIds: string[];
};

type SeatGroupTransformSnapshot = ObjectTransformSnapshot & {
  seatWidth: number;
  seatHeight: number;
  gapX: number;
  gapY: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
};

type SeatGroupTransformSession = {
  snapshots: Map<string, SeatGroupTransformSnapshot>;
  initialBounds: ReturnType<typeof getSnapshotsUnionBounds>;
  initialRotation: number;
  currentScale: number;
  currentRotationDelta: number;
};

export type MapTransformStageContext = CorridorTransformStageContext & {
  snap?: CorridorSnapCommitContext;
};

export type MapTransformCommitResult = {
  objectUpdates: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seatUpdates: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
  seatGroupUpdates: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }>;
  corridorPatches: CorridorTransformPreviewPatch[];
};

export function beginUniformTransformSession(
  map: EventMapDTO,
  selectedObjectIds: string[],
  stage: Konva.Stage,
  transformer: Konva.Transformer,
): UniformTransformSession | null {
  return beginObjectTransformSession(map, selectedObjectIds, stage, transformer);
}

export function beginMapTransformSession(input: {
  kind: MapTransformSessionKind;
  map: EventMapDTO;
  corridorIds: string[];
  selectedObjectIds: string[];
  selectedSeatIds: string[];
  selectedSeatGroupIds: string[];
  stage: Konva.Stage;
  transformer: Konva.Transformer;
}): MapTransformSession | null {
  const { kind, map, corridorIds, selectedObjectIds, selectedSeatIds, selectedSeatGroupIds, stage, transformer } = input;
  const seatGroupTransform = beginSeatGroupTransformSession(map, selectedSeatGroupIds, stage, transformer);

  if (kind === 'corridor') {
    const corridor = beginCorridorTransformToolSession(map, corridorIds, transformer, stage);
    if (!corridor) return null;
    return {
      kind,
      corridor,
      objectTransform: null,
      seatGroupTransform,
      selectedObjectIds,
      selectedSeatIds,
      selectedSeatGroupIds,
    };
  }

  if (kind === 'uniform') {
    const objectTransform = beginObjectTransformSession(map, selectedObjectIds, stage, transformer);
    if (!objectTransform) return null;
    return {
      kind,
      corridor: null,
      objectTransform,
      seatGroupTransform,
      selectedObjectIds,
      selectedSeatIds,
      selectedSeatGroupIds,
    };
  }

  const objectTransform = beginObjectTransformSession(map, selectedObjectIds, stage, transformer, {
    excludeCorridors: true,
  });
  if (!objectTransform && selectedSeatIds.length === 0 && selectedSeatGroupIds.length === 0) return null;

  return {
    kind: 'generic',
    corridor: null,
    objectTransform,
    seatGroupTransform,
    selectedObjectIds,
    selectedSeatIds,
    selectedSeatGroupIds,
  };
}

function readNodeScale(stage: Konva.Stage, objectId: string) {
  const node = stage.findOne(`#node-${objectId}`);
  if (!node) return null;
  return { scaleX: node.scaleX(), scaleY: node.scaleY() };
}

function readSeatGroupNodeScale(stage: Konva.Stage, groupId: string) {
  const node = stage.findOne(`#node-seatgroup-${groupId}`);
  if (!node) return null;
  return { scaleX: node.scaleX(), scaleY: node.scaleY() };
}

function beginSeatGroupTransformSession(
  map: EventMapDTO,
  selectedSeatGroupIds: string[],
  stage: Konva.Stage,
  transformer: Konva.Transformer,
): SeatGroupTransformSession | null {
  const snapshots = new Map<string, SeatGroupTransformSnapshot>();

  for (const groupId of selectedSeatGroupIds) {
    const group = map.seatGroups?.find((entry) => entry.id === groupId);
    if (!group || group.locked) continue;
    const bounds = getSeatGroupTightBounds(group, map.seats);
    snapshots.set(groupId, {
      x: group.x,
      y: group.y,
      width: bounds.width,
      height: bounds.height,
      rotation: group.rotation ?? 0,
      type: 'SEAT_GROUP',
      seatWidth: group.seatWidth,
      seatHeight: group.seatHeight,
      gapX: group.gapX,
      gapY: group.gapY,
      paddingTop: group.paddingTop,
      paddingRight: group.paddingRight,
      paddingBottom: group.paddingBottom,
      paddingLeft: group.paddingLeft,
    });

    const node = stage.findOne(`#node-seatgroup-${groupId}`);
    if (node) resetNodeScale(node);
  }

  if (snapshots.size === 0) return null;
  return {
    snapshots,
    initialBounds: getSnapshotsUnionBounds([...snapshots.values()]),
    initialRotation: transformer.rotation(),
    currentScale: 1,
    currentRotationDelta: 0,
  };
}

function buildSeatGroupPatchFromUniformTransform(snapshot: SeatGroupTransformSnapshot, patch: ReturnType<typeof computeUniformTransformPatch>) {
  const scale = Math.max(
    Math.abs((typeof patch.width === 'number' ? patch.width : snapshot.width) / snapshot.width),
    Math.abs((typeof patch.height === 'number' ? patch.height : snapshot.height) / snapshot.height),
    0.001,
  );

  return {
    x: patch.x,
    y: patch.y,
    rotation: patch.rotation,
    seatWidth: Math.max(MIN_OBJECT_SIZE, snapshot.seatWidth * scale),
    seatHeight: Math.max(MIN_OBJECT_SIZE, snapshot.seatHeight * scale),
    gapX: Math.max(0, snapshot.gapX * scale),
    gapY: Math.max(0, snapshot.gapY * scale),
    paddingTop: Math.max(0, snapshot.paddingTop * scale),
    paddingRight: Math.max(0, snapshot.paddingRight * scale),
    paddingBottom: Math.max(0, snapshot.paddingBottom * scale),
    paddingLeft: Math.max(0, snapshot.paddingLeft * scale),
  };
}

function applySeatGroupTransformLivePreview(session: SeatGroupTransformSession, stage: Konva.Stage, transformer: Konva.Transformer) {
  const scale = resolveLiveUniformScale(session.snapshots, (groupId) => readSeatGroupNodeScale(stage, groupId));
  const rotationDelta = transformer.rotation() - session.initialRotation;
  session.currentScale = scale;
  session.currentRotationDelta = rotationDelta;

  for (const [groupId, snapshot] of session.snapshots) {
    const node = stage.findOne(`#node-seatgroup-${groupId}`);
    if (!node) continue;
    const patch = computeUniformTransformPatch(
      snapshot,
      session.initialBounds.centerX,
      session.initialBounds.centerY,
      scale,
      rotationDelta,
    );
    node.x(patch.x);
    node.y(patch.y);
    node.rotation(patch.rotation ?? 0);
    resetNodeScale(node);
  }
}

function buildSeatGroupTransformCommits(session: SeatGroupTransformSession, stage: Konva.Stage, transformer: Konva.Transformer) {
  const liveScale = resolveLiveUniformScale(session.snapshots, (groupId) => readSeatGroupNodeScale(stage, groupId));
  if (Math.abs(liveScale - 1) > 0.001) session.currentScale = liveScale;
  session.currentRotationDelta = transformer.rotation() - session.initialRotation;
  const scale = session.currentScale;
  const rotationDelta = session.currentRotationDelta;
  const updates: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }> = [];

  for (const [groupId, snapshot] of session.snapshots) {
    const patch = computeUniformTransformPatch(
      snapshot,
      session.initialBounds.centerX,
      session.initialBounds.centerY,
      scale,
      rotationDelta,
      { clampDimensions: true },
    );
    updates.push({ id: groupId, patch: buildSeatGroupPatchFromUniformTransform(snapshot, patch) });
    const node = stage.findOne(`#node-seatgroup-${groupId}`);
    if (node) resetNodeScale(node);
  }

  return updates;
}

export function applyMapTransformLivePreview(
  session: MapTransformSession,
  ctx: MapTransformStageContext,
) {
  const { stage, transformer } = ctx;

  if (session.kind === 'corridor' && session.corridor) {
    applyCorridorTransformLivePreview(session.corridor, ctx);
    transformer.forceUpdate();
    return;
  }

  if (session.objectTransform) {
    if (session.kind === 'generic') {
      transformer.forceUpdate();
      return;
    }

    const scale = resolveLiveObjectTransformScale(session.objectTransform, (objectId) =>
      readNodeScale(stage, objectId),
    );
    applyObjectTransformLivePreview({ session: session.objectTransform, stage, transformer, scale });
    transformer.forceUpdate();
  }

  if (session.seatGroupTransform) {
    applySeatGroupTransformLivePreview(session.seatGroupTransform, stage, transformer);
    transformer.forceUpdate();
  }
}

export function buildMapTransformCommit(
  session: MapTransformSession,
  ctx: MapTransformStageContext,
  map: EventMapDTO,
): MapTransformCommitResult {
  const { stage, transformer } = ctx;
  const objectUpdates: Array<{ id: string; patch: Partial<EventMapObjectDTO> }> = [];
  const seatUpdates: Array<{ id: string; patch: Partial<EventSeatDTO> }> = [];
  const seatGroupUpdates: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }> = [];
  let corridorPatches: CorridorTransformPreviewPatch[] = [];

  if (session.kind === 'corridor' && session.corridor) {
    corridorPatches = buildCorridorTransformCommitPatches(session.corridor, ctx, ctx.snap);
  } else if (session.objectTransform) {
    if (session.kind === 'generic') {
      const updates = readObjectTransformCommitFromNodes(
        stage,
        session.objectTransform,
        [...session.objectTransform.snapshots.keys()],
        { scaleMode: 'independent' },
      );
      for (const entry of updates) {
        objectUpdates.push({ id: entry.id, patch: entry.patch });
      }
    } else {
      const scale = resolveLiveObjectTransformScale(session.objectTransform, (objectId) =>
        readNodeScale(stage, objectId),
      );
      applyObjectTransformLivePreview({ session: session.objectTransform, stage, transformer, scale });
      const selectedIds =
        session.kind === 'uniform' ? session.selectedObjectIds : [...session.objectTransform.snapshots.keys()];
      const updates = readObjectTransformCommitFromNodes(stage, session.objectTransform, selectedIds);
      for (const entry of updates) {
        objectUpdates.push({ id: entry.id, patch: entry.patch });
      }
    }
  }

  for (const objectId of session.selectedObjectIds) {
    const object = map.objects.find((entry) => entry.id === objectId);
    const node = stage.findOne(`#node-${objectId}`);
    if (!object || !node || object.type === 'TEXT' || object.type === 'CORRIDOR') continue;
    if (session.kind === 'uniform' || session.kind === 'generic') continue;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const bounds = getObjectBounds(object);
    const x = node.x();
    const y = node.y();
    const width = Math.max(MIN_OBJECT_SIZE, bounds.width * Math.abs(scaleX || 1));
    const height = Math.max(MIN_OBJECT_SIZE, bounds.height * Math.abs(scaleY || 1));
    const rotation = node.rotation();

    resetNodeScale(node);

    if (![x, y, width, height, rotation].every(Number.isFinite)) continue;
    objectUpdates.push({ id: objectId, patch: { x, y, width, height, rotation } });
  }

  for (const seatId of session.selectedSeatIds) {
    const seat = map.seats.find((entry) => entry.id === seatId);
    const node = stage.findOne(`#node-${seatId}`);
    if (!seat || !node || seat.status === 'SOLD') continue;

    const patch = readSeatTransformFromNode(node, seat.size ?? 24);
    if (!patch) continue;
    seatUpdates.push({ id: seatId, patch });
  }

  if (session.seatGroupTransform) {
    seatGroupUpdates.push(...buildSeatGroupTransformCommits(session.seatGroupTransform, stage, transformer));
  } else {
    for (const groupId of session.selectedSeatGroupIds) {
      const group = map.seatGroups?.find((entry) => entry.id === groupId);
      const node = stage.findOne(`#node-seatgroup-${groupId}`);
      if (!group || !node || group.locked) continue;

      const patch = readSeatGroupTransformFromNode(node, group);
      if (!patch) continue;
      seatGroupUpdates.push({ id: groupId, patch });
    }
  }

  return { objectUpdates, seatUpdates, seatGroupUpdates, corridorPatches };
}

export function resetMapTransformTransformer(session: MapTransformSession, transformer: Konva.Transformer) {
  if (session.kind === 'corridor') {
    resetCorridorTransformer(transformer);
  }
}

export type { ObjectTransformSnapshot };
